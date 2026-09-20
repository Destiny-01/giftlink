// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/*
GiftLink.sol - USDC-Only Gift Protocol with Gas Tank

Simplified for USDC-only transfers with gasless claiming.
- ONLY supports USDC (no ETH, no other tokens)
- Backend-signed permits for claim authorization (EIP-712)
- Gas tank system: sender pre-funds gas in USDC, relayer gets reimbursed in USDC
- Minimal on-chain storage (metadata stored off-chain)
- User wallets execute create transactions, relayer executes claims
*/

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract GiftLink is Context, ReentrancyGuard, Ownable, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // EIP-712 domain
    string private constant SIGNING_DOMAIN = "GiftLinkPermit";
    string private constant SIGNATURE_VERSION = "1";

    // EIP-712 typehash for claim permits
    bytes32 private constant CLAIM_PERMIT_TYPEHASH = 
        keccak256("ClaimPermit(uint256 dropId,address claimer,uint64 expiry)");

    // Drop status
    uint8 private constant STATUS_ACTIVE = 0;
    uint8 private constant STATUS_CLAIMED = 1;
    uint8 private constant STATUS_REVOKED = 2;
    uint8 private constant STATUS_EXPIRED = 3;

    // Recipient types (matches backend enums)
    uint8 public constant TYPE_PUBLIC = 0;
    uint8 public constant TYPE_EMAIL = 1;
    uint8 public constant TYPE_DISCORD = 2;
    uint8 public constant TYPE_TWITTER = 3;
    uint8 public constant TYPE_WALLET = 4;

    // USDC contract address (immutable)
    address public immutable USDC;

    // Default gas tank amount in USDC (6 decimals: 2000000 = 2 USDC)
    uint128 public defaultGasTankAmount;

    // Compact Drop struct (gas-optimized)
    struct Drop {
        address sender;          // Who created the drop
        uint128 amount;          // USDC amount for recipient (6 decimals)
        uint128 gasTankAmount;   // USDC amount reserved for gas reimbursement
        uint64 expiry;           // Unix timestamp (0 = no expiry)
        uint64 createdAt;        // Creation timestamp
        bytes32 recipientCommit; // keccak256(recipientHash, serverPepper, dropId)
        uint8 recipientType;     // Type of recipient
        uint8 status;            // Drop status
    }

    // Storage
    mapping(uint256 => Drop) private _drops;
    
    // Nonce for additional randomness
    uint256 private _nonce;

    // Backend signer for claim authorization
    address public backendSigner;

    // Track drops by sender for dashboard queries
    mapping(address => uint256[]) private _dropsBySender;

    // Events
    event DropCreated(
        uint256 indexed dropId,
        address indexed sender,
        uint128 amount,
        uint128 gasTankAmount,
        bytes32 recipientCommit,
        uint8 recipientType,
        uint64 expiry
    );

    event DropClaimed(
        uint256 indexed dropId,
        address indexed claimer,
        address indexed relayer,
        uint128 amountToClaimer,
        uint128 amountToRelayer
    );

    event DropRevoked(
        uint256 indexed dropId,
        address indexed sender,
        uint128 totalRefunded
    );

    event ReceiverUpdated(
        uint256 indexed dropId,
        bytes32 oldCommit,
        bytes32 newCommit
    );

    event BackendSignerUpdated(
        address indexed oldSigner,
        address indexed newSigner
    );

    event DefaultGasTankUpdated(
        uint128 oldAmount,
        uint128 newAmount
    );

    constructor(
        address usdcAddress,
        address initialBackendSigner,
        uint128 initialGasTank
    ) 
        EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) 
        Ownable(msg.sender) 
    {
        require(usdcAddress != address(0), "Invalid USDC address");
        require(initialBackendSigner != address(0), "Invalid backend signer");
        USDC = usdcAddress;
        backendSigner = initialBackendSigner;
        defaultGasTankAmount = initialGasTank;
    }

    // ---------------------------
    // Modifiers
    // ---------------------------

    modifier onlyActive(uint256 dropId) {
        require(_drops[dropId].status == STATUS_ACTIVE, "Drop not active");
        _;
    }

    modifier onlySender(uint256 dropId) {
        require(_msgSender() == _drops[dropId].sender, "Only sender");
        _;
    }

    function _isExpired(Drop storage d) internal view returns (bool) {
        if (d.expiry == 0) return false;
        return block.timestamp > d.expiry;
    }

    // ---------------------------
    // Drop Creation (User Wallet)
    // ---------------------------

    /**
     * @notice Create a drop with USDC
     * @dev User must approve: amount + gasTankAmount before calling
     * @param amount USDC amount for recipient (6 decimals, e.g., 100000000 = 100 USDC)
     * @param gasTankAmount USDC for gas reimbursement (0 = use default)
     * @param recipientCommit Commitment hash from backend
     * @param recipientType Type of recipient (0=public, 1=email, etc.)
     * @param expiry Unix timestamp for expiry (0 = no expiry)
     * @return dropId The on-chain drop ID
     */
    function createDrop(
        uint128 amount,
        uint128 gasTankAmount,
        bytes32 recipientCommit,
        uint8 recipientType,
        uint64 expiry
    ) external nonReentrant returns (uint256) {
        require(amount > 0, "Amount must be > 0");
        require(recipientType <= TYPE_WALLET, "Invalid recipient type");

        // Use default gas tank if not specified
        uint128 actualGasTank = gasTankAmount > 0 ? gasTankAmount : defaultGasTankAmount;
        
        // Transfer total amount (recipient + gas tank) to contract
        uint256 totalAmount = uint256(amount) + uint256(actualGasTank);
        IERC20(USDC).safeTransferFrom(_msgSender(), address(this), totalAmount);

        // Generate pseudo-random ID from timestamp, sender, and nonce
        uint32 id = uint32(block.timestamp ^ _nonce);
        
        // Increment nonce for next drop
        _nonce++;
        
        // Ensure ID doesn't collide (extremely unlikely but safe)
        require(_drops[id].sender == address(0), "ID collision");

        Drop storage d = _drops[id];
        d.sender = _msgSender();
        d.amount = amount;
        d.gasTankAmount = actualGasTank;
        d.recipientCommit = recipientCommit;
        d.recipientType = recipientType;
        d.expiry = expiry;
        d.createdAt = uint64(block.timestamp);
        d.status = STATUS_ACTIVE;

        // Track for sender dashboard
        _dropsBySender[_msgSender()].push(id);

        emit DropCreated(id, d.sender, amount, actualGasTank, recipientCommit, recipientType, expiry);
        return id;
    }

    // ---------------------------
    // Drop Claiming (Relayer-Executed)
    // ---------------------------

    /**
     * @notice Claim a drop with backend-signed permit (executed by relayer)
     * @dev Relayer pays gas, gets reimbursed in USDC from gas tank
     * @param dropId The drop ID to claim
     * @param claimer The address receiving USDC
     * @param permitExpiry Expiry timestamp for the permit
     * @param signature Backend's EIP-712 signature
     */
    function claimWithPermit(
        uint256 dropId,
        address claimer,
        uint64 permitExpiry,
        bytes calldata signature
    ) external nonReentrant returns (bool) {
        require(claimer != address(0), "Invalid claimer");
        Drop storage d = _drops[dropId];
        require(d.status == STATUS_ACTIVE, "Drop not active");
        require(!_isExpired(d), "Drop expired");

        // Verify permit not expired
        require(block.timestamp <= permitExpiry, "Permit expired");

        // Verify backend signature (EIP-712)
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_PERMIT_TYPEHASH, dropId, claimer, permitExpiry)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        require(signer == backendSigner, "Invalid permit signature");

        // Mark claimed (CEI pattern)
        d.status = STATUS_CLAIMED;

        address relayer = _msgSender(); // Backend relayer wallet

        // Transfer USDC
        IERC20(USDC).safeTransfer(claimer, uint256(d.amount));
        IERC20(USDC).safeTransfer(relayer, uint256(d.gasTankAmount));

        emit DropClaimed(dropId, claimer, relayer, d.amount, d.gasTankAmount);
        return true;
    }

    /**
     * @notice Claim a public drop (no authorization needed, executed by relayer)
     * @dev For TYPE_PUBLIC drops only
     * @param dropId The drop ID to claim
     * @param claimer The address receiving USDC
     */
    function claimPublic(uint256 dropId, address claimer) external nonReentrant returns (bool) {
        require(claimer != address(0), "Invalid claimer");
        Drop storage d = _drops[dropId];
        require(d.status == STATUS_ACTIVE, "Drop not active");
        require(!_isExpired(d), "Drop expired");
        require(d.recipientType == TYPE_PUBLIC, "Not a public drop");

        // Mark claimed
        d.status = STATUS_CLAIMED;

        address relayer = _msgSender();

        // Transfer USDC
        IERC20(USDC).safeTransfer(claimer, uint256(d.amount));
        IERC20(USDC).safeTransfer(relayer, uint256(d.gasTankAmount));

        emit DropClaimed(dropId, claimer, relayer, d.amount, d.gasTankAmount);
        return true;
    }

    // ---------------------------
    // Drop Management
    // ---------------------------

    /**
     * @notice Revoke an unclaimed drop and get full USDC refund (amount + gas tank)
     * @dev Only sender can revoke their own drops
     */
    function revokeDrop(uint256 dropId) 
        external 
        nonReentrant 
        onlySender(dropId) 
        onlyActive(dropId) 
    {
        Drop storage d = _drops[dropId];
        
        // Mark revoked
        d.status = STATUS_REVOKED;

        uint128 totalRefund = d.amount + d.gasTankAmount;

        // Refund USDC
        IERC20(USDC).safeTransfer(d.sender, uint256(totalRefund));

        emit DropRevoked(dropId, d.sender, totalRefund);
    }

    /**
     * @notice Update recipient commitment for an unclaimed drop
     * @dev Backend computes new commitment with same pepper
     */
    function updateReceiver(
        uint256 dropId,
        bytes32 newRecipientCommit
    ) 
        external 
        onlySender(dropId) 
        onlyActive(dropId) 
    {
        Drop storage d = _drops[dropId];
        bytes32 oldCommit = d.recipientCommit;
        d.recipientCommit = newRecipientCommit;

        emit ReceiverUpdated(dropId, oldCommit, newRecipientCommit);
    }

    /**
     * @notice Mark an expired drop
     * @dev Anyone can call to update status for indexing
     */
    function markExpired(uint256 dropId) external {
        Drop storage d = _drops[dropId];
        require(d.status == STATUS_ACTIVE, "Drop not active");
        require(_isExpired(d), "Not expired yet");
        d.status = STATUS_EXPIRED;
    }

    // ---------------------------
    // Admin Functions
    // ---------------------------

    /**
     * @notice Update the backend signer address
     */
    function updateBackendSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Invalid signer");
        address old = backendSigner;
        backendSigner = newSigner;
        emit BackendSignerUpdated(old, newSigner);
    }

    /**
     * @notice Update default gas tank amount (in USDC, 6 decimals)
     * @dev Applies to new drops that don't specify a custom amount
     */
    function updateDefaultGasTank(uint128 newAmount) external onlyOwner {
        uint128 old = defaultGasTankAmount;
        defaultGasTankAmount = newAmount;
        emit DefaultGasTankUpdated(old, newAmount);
    }

    // ---------------------------
    // View Functions
    // ---------------------------

    function getDrop(uint256 dropId) external view returns (
        address sender,
        uint128 amount,
        uint128 gasTankAmount,
        bytes32 recipientCommit,
        uint8 recipientType,
        uint8 status,
        uint64 expiry,
        uint64 createdAt
    ) {
        Drop storage d = _drops[dropId];
        return (
            d.sender,
            d.amount,
            d.gasTankAmount,
            d.recipientCommit,
            d.recipientType,
            d.status,
            d.expiry,
            d.createdAt
        );
    }

    function dropCount() external view returns (uint256) {
        return _nonce; // Returns total number of drops created
    }

    function getDropsBySender(address sender) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return _dropsBySender[sender];
    }

    function getContractBalance() external view returns (uint256) {
        return IERC20(USDC).balanceOf(address(this));
    }

    // ---------------------------
    // Emergency Functions
    // ---------------------------

    function emergencyWithdrawUSDC() external onlyOwner {
        uint256 balance = IERC20(USDC).balanceOf(address(this));
        IERC20(USDC).safeTransfer(owner(), balance);
    }
}