// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * Nomine Claim Core.
 *
 * One immutable, fully funded, fixed-allocation USDC campaign per funding call.
 * A listed entitlement settles exactly once, only against the claimant's own
 * signed wallet selection and two independent EIP-712 attestations over that
 * same request. There is no owner, no upgrade path, no authority replacement and
 * no administrative sweep: the absence of those functions is the guarantee.
 *
 * Trust boundary (see docs/DECISIONS.md D-006 / D-019): the contract verifies
 * wallet consent and both approving authorities. It cannot prove that an
 * entitlement identifier corresponds to an off-chain identity, nor that the two
 * authorities are controlled by different organisations; it can only refuse a
 * configuration that names the same address for both. Wallet consent proves
 * control of the wallet, not ownership of the identity behind the entitlement.
 * Collusion between both Gate authorities remains an explicit Gate-trust risk.
 */
contract NomineClaimCore is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice USDC ERC-20 interface escrowed and settled by every campaign.
    IERC20 public immutable USDC;

    /// @notice Claimant consent over the exact payout they are requesting.
    bytes32 public constant CLAIM_REQUEST_TYPEHASH = keccak256(
        "ClaimRequest(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline)"
    );

    /// @notice Either approving authority's attestation over the same request.
    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "Approval(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline,bytes32 consentDigest)"
    );

    struct Campaign {
        address issuer; // Funder; the only address that may reclaim.
        address issuerApprover; // Independent issuer approval key; held outside Nomine.
        address resolver; // Nomine Resolver approval key. Must differ from issuerApprover.
        address recoveryDestination; // Fixed at funding; receives unused funds after expiry.
        uint128 allocation; // Exact USDC transferred by every settlement.
        uint32 entitlementCount; // Number of listed entitlements; all fully funded.
        uint32 settlementCount; // Entitlements consumed so far.
        uint64 openingTime; // Earliest settlement time.
        uint64 expiryTime; // Settlement is refused at and after this time.
        bytes32 entitlementRoot; // Commitment over the actual entitlement identifiers.
        bool reclaimed; // Set once the unused balance has been returned.
    }

    /// @dev Everything fixed at funding. Passed as one struct so the funding call
    /// stays readable and the immutable configuration is a single object.
    struct CampaignConfig {
        address issuerApprover; // Independent issuer approval key; held outside Nomine.
        address resolver; // Nomine Resolver approval key. Must differ from issuerApprover.
        address recoveryDestination; // Receives unused funds after expiry.
        uint128 allocation; // Exact USDC transferred by every settlement.
        uint32 entitlementCount; // Number of listed entitlements; all fully funded.
        uint64 openingTime; // Earliest settlement time.
        uint64 expiryTime; // Settlement is refused at and after this time.
        bytes32 entitlementRoot; // Commitment over the actual entitlement identifiers.
    }

    /// @dev Exactly the fields the claimant signs. `wallet` is the payout address.
    struct ClaimRequest {
        uint256 campaignId;
        bytes32 entitlementId;
        address wallet;
        uint256 amount;
        uint64 deadline;
    }

    /// @dev An authority's attestation. `consentDigest` is the claimant's EIP-712
    /// digest, so the approval is tied to the signed request itself rather than to
    /// any ordering in time that signatures alone cannot establish.
    struct Approval {
        uint256 campaignId;
        bytes32 entitlementId;
        address wallet;
        uint256 amount;
        uint64 deadline;
        bytes32 consentDigest;
    }

    uint256 private _campaignCount;

    mapping(uint256 campaignId => Campaign) private _campaigns;
    /// @dev campaignId => entitlementId => settled.
    mapping(uint256 => mapping(bytes32 => bool)) private _consumed;

    event CampaignFunded(
        uint256 indexed campaignId,
        address indexed issuer,
        address indexed issuerApprover,
        address resolver,
        address recoveryDestination,
        uint128 allocation,
        uint32 entitlementCount,
        uint256 fundedAmount,
        uint64 openingTime,
        uint64 expiryTime,
        bytes32 entitlementRoot
    );

    /// @dev Canonical settlement evidence. `entitlementId` is an opaque,
    /// campaign-specific identifier and is the only entitlement fact emitted:
    /// no raw identity data is ever written on-chain or into an event.
    /// There is deliberately no expiry event; time passing creates no transition.
    event Settlement(
        uint256 indexed campaignId,
        bytes32 indexed entitlementId,
        address indexed wallet,
        uint256 amount,
        address submitter
    );

    event CampaignReclaimed(
        uint256 indexed campaignId,
        address indexed recoveryDestination,
        uint256 amount
    );

    error CampaignNotFound(uint256 campaignId);
    error CampaignReclaimedAlready(uint256 campaignId);
    error CampaignNotOpen(uint256 campaignId, uint64 openingTime, uint256 nowTimestamp);
    error CampaignExpired(uint256 campaignId, uint64 expiryTime, uint256 nowTimestamp);
    error EntitlementCountReached(uint256 campaignId, uint32 entitlementCount);
    error ZeroAddress();
    error ZeroValue();
    error InvalidRecoveryDestination(address destination);
    error AuthoritiesNotDistinct();
    error InvalidWindow(uint64 openingTime, uint64 expiryTime);
    error EntitlementNotListed(uint256 campaignId);
    error EntitlementAlreadyConsumed(uint256 campaignId, bytes32 entitlementId);
    error AmountNotAllocation(uint256 provided, uint128 allocation);
    error ApprovalExpired(uint64 deadline, uint256 nowTimestamp);
    error ApprovalMismatch();
    error InvalidClaimantConsent();
    error InvalidIssuerApproval();
    error InvalidResolverApproval();
    error FundingAmountMismatch(uint256 expected, uint256 received);
    error NotIssuer(address caller, address issuer);
    error NotExpired(uint256 campaignId, uint64 expiryTime, uint256 nowTimestamp);
    error UsdcTransferFailed();

    constructor(address usdc_) EIP712("NomineClaimCore", "1") {
        if (usdc_ == address(0)) revert ZeroAddress();
        USDC = IERC20(usdc_);
    }

    // ------------------------------------------------------------------
    // Campaign funding
    // ------------------------------------------------------------------

    /**
     * @notice Create and fully fund one immutable campaign.
     *
     * @dev The caller is the issuer. The full budget — `allocation * entitlementCount` —
     * is transferred atomically, so an unfunded campaign never exists. Every listed
     * entitlement is backed by its own allocation; there is no cap that the eligible
     * list may exceed. `issuerApprover` and `resolver` must be different addresses.
     */
    function createCampaign(CampaignConfig calldata config) external nonReentrant returns (uint256 campaignId) {
        if (
            config.issuerApprover == address(0) ||
            config.resolver == address(0) ||
            config.recoveryDestination == address(0)
        ) {
            revert ZeroAddress();
        }
        if (config.issuerApprover == config.resolver) revert AuthoritiesNotDistinct();
        if (config.recoveryDestination == address(this) || config.recoveryDestination == address(USDC)) {
            revert InvalidRecoveryDestination(config.recoveryDestination);
        }
        if (config.allocation == 0 || config.entitlementCount == 0) revert ZeroValue();
        if (config.entitlementRoot == bytes32(0)) revert ZeroValue();
        if (config.expiryTime <= config.openingTime || config.expiryTime <= block.timestamp) {
            revert InvalidWindow(config.openingTime, config.expiryTime);
        }

        uint256 budget = uint256(config.allocation) * uint256(config.entitlementCount);

        uint256 balanceBefore = USDC.balanceOf(address(this));
        USDC.safeTransferFrom(msg.sender, address(this), budget);
        uint256 received = USDC.balanceOf(address(this)) - balanceBefore;
        if (received != budget) revert FundingAmountMismatch(budget, received);

        campaignId = ++_campaignCount;
        Campaign storage campaign = _campaigns[campaignId];
        campaign.issuer = msg.sender;
        campaign.issuerApprover = config.issuerApprover;
        campaign.resolver = config.resolver;
        campaign.recoveryDestination = config.recoveryDestination;
        campaign.allocation = config.allocation;
        campaign.entitlementCount = config.entitlementCount;
        campaign.openingTime = config.openingTime;
        campaign.expiryTime = config.expiryTime;
        campaign.entitlementRoot = config.entitlementRoot;

        emit CampaignFunded(
            campaignId,
            msg.sender,
            config.issuerApprover,
            config.resolver,
            config.recoveryDestination,
            config.allocation,
            config.entitlementCount,
            budget,
            config.openingTime,
            config.expiryTime,
            config.entitlementRoot
        );
    }

    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    /**
     * @notice Settle one listed entitlement to the wallet the claimant signed for.
     *
     * @dev Permissionless submission: the relayer chooses nothing. Every fact that
     * determines the payout is bound by the claimant's consent and by both
     * attestations, so any submitter produces the same result. The entitlement is
     * consumed before the transfer, and the transfer is exactly the campaign's
     * fixed allocation.
     *
     * @param request The claimant's signed payout request.
     * @param claimantSignature EIP-712 signature by `request.wallet` over `request`.
     * @param approval Both authorities' attestation payload (identical bytes for both).
     * @param issuerApprovalSignature EIP-712 signature by the campaign's issuer approver.
     * @param resolverApprovalSignature EIP-712 signature by the campaign's resolver.
     * @param entitlementProof Merkle proof that `request.entitlementId` is listed.
     */
    function settle(
        ClaimRequest calldata request,
        bytes calldata claimantSignature,
        Approval calldata approval,
        bytes calldata issuerApprovalSignature,
        bytes calldata resolverApprovalSignature,
        bytes32[] calldata entitlementProof
    ) external nonReentrant {
        uint256 campaignId = request.campaignId;
        Campaign storage campaign = _campaigns[campaignId];
        if (campaign.issuer == address(0)) revert CampaignNotFound(campaignId);
        if (campaign.reclaimed) revert CampaignReclaimedAlready(campaignId);

        uint256 nowTimestamp = block.timestamp;
        if (nowTimestamp < campaign.openingTime) {
            revert CampaignNotOpen(campaignId, campaign.openingTime, nowTimestamp);
        }
        if (nowTimestamp >= campaign.expiryTime) {
            revert CampaignExpired(campaignId, campaign.expiryTime, nowTimestamp);
        }
        if (campaign.settlementCount >= campaign.entitlementCount) {
            revert EntitlementCountReached(campaignId, campaign.entitlementCount);
        }
        if (request.amount != uint256(campaign.allocation)) {
            revert AmountNotAllocation(request.amount, campaign.allocation);
        }
        if (nowTimestamp > request.deadline) {
            revert ApprovalExpired(request.deadline, nowTimestamp);
        }
        if (_consumed[campaignId][request.entitlementId]) {
            revert EntitlementAlreadyConsumed(campaignId, request.entitlementId);
        }
        if (!MerkleProof.verify(entitlementProof, campaign.entitlementRoot, request.entitlementId)) {
            revert EntitlementNotListed(campaignId);
        }

        // The approvals must attest the exact request the claimant signed.
        if (
            approval.campaignId != request.campaignId ||
            approval.entitlementId != request.entitlementId ||
            approval.wallet != request.wallet ||
            approval.amount != request.amount ||
            approval.deadline != request.deadline
        ) {
            revert ApprovalMismatch();
        }

        bytes32 consentDigest = _hashTypedDataV4(_hashClaimRequest(request));
        if (approval.consentDigest != consentDigest) revert ApprovalMismatch();
        if (ECDSA.recover(consentDigest, claimantSignature) != request.wallet) {
            revert InvalidClaimantConsent();
        }

        bytes32 attestationDigest = _hashTypedDataV4(_hashApproval(approval));
        if (ECDSA.recover(attestationDigest, issuerApprovalSignature) != campaign.issuerApprover) {
            revert InvalidIssuerApproval();
        }
        if (ECDSA.recover(attestationDigest, resolverApprovalSignature) != campaign.resolver) {
            revert InvalidResolverApproval();
        }

        _consumed[campaignId][request.entitlementId] = true;
        campaign.settlementCount += 1;

        USDC.safeTransfer(request.wallet, uint256(campaign.allocation));

        emit Settlement(
            campaignId,
            request.entitlementId,
            request.wallet,
            uint256(campaign.allocation),
            msg.sender
        );
    }

    // ------------------------------------------------------------------
    // Expiry recovery
    // ------------------------------------------------------------------

    /**
     * @notice Return the unused balance to the recovery destination fixed at funding.
     *
     * @dev Issuer-only and expiry-only. It depends on neither Gate attestation nor
     * claimant consent, so losing an approving key stops settlements but never
     * strands the unused funds. It transfers exactly the unsettled portion and
     * touches nothing that was settled.
     */
    function reclaim(uint256 campaignId) external nonReentrant returns (uint256 amount) {
        Campaign storage campaign = _campaigns[campaignId];
        if (campaign.issuer == address(0)) revert CampaignNotFound(campaignId);
        if (msg.sender != campaign.issuer) revert NotIssuer(msg.sender, campaign.issuer);
        if (block.timestamp < campaign.expiryTime) {
            revert NotExpired(campaignId, campaign.expiryTime, block.timestamp);
        }
        if (campaign.reclaimed) revert CampaignReclaimedAlready(campaignId);

        campaign.reclaimed = true;
        amount = uint256(campaign.entitlementCount - campaign.settlementCount) * uint256(campaign.allocation);
        if (amount > 0) {
            USDC.safeTransfer(campaign.recoveryDestination, amount);
        }

        emit CampaignReclaimed(campaignId, campaign.recoveryDestination, amount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function campaignCount() external view returns (uint256) {
        return _campaignCount;
    }

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return _campaigns[campaignId];
    }

    function isEntitlementConsumed(uint256 campaignId, bytes32 entitlementId) external view returns (bool) {
        return _consumed[campaignId][entitlementId];
    }

    /// @notice Fully funded budget implied by the campaign's fixed allocation and count.
    function budgetOf(uint256 campaignId) public view returns (uint256) {
        Campaign storage campaign = _campaigns[campaignId];
        return uint256(campaign.allocation) * uint256(campaign.entitlementCount);
    }

    /// @notice USDC already settled by this campaign.
    function settledAmountOf(uint256 campaignId) public view returns (uint256) {
        Campaign storage campaign = _campaigns[campaignId];
        return uint256(campaign.settlementCount) * uint256(campaign.allocation);
    }

    /// @notice USDC still owed to unsettled entitlements.
    function remainingUnsettledOf(uint256 campaignId) public view returns (uint256) {
        Campaign storage campaign = _campaigns[campaignId];
        return uint256(campaign.entitlementCount - campaign.settlementCount) * uint256(campaign.allocation);
    }

    /// @notice USDC the issuer would still receive at reclaim; zero once reclaimed.
    function reclaimableOf(uint256 campaignId) public view returns (uint256) {
        Campaign storage campaign = _campaigns[campaignId];
        if (campaign.reclaimed) return 0;
        return budgetOf(campaignId) - settledAmountOf(campaignId);
    }

    /** @dev EIP-712 struct hash of the claimant's request. */
    function _hashClaimRequest(ClaimRequest calldata request) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CLAIM_REQUEST_TYPEHASH,
                request.campaignId,
                request.entitlementId,
                request.wallet,
                request.amount,
                request.deadline
            )
        );
    }

    function _hashApproval(Approval calldata approval) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                APPROVAL_TYPEHASH,
                approval.campaignId,
                approval.entitlementId,
                approval.wallet,
                approval.amount,
                approval.deadline,
                approval.consentDigest
            )
        );
    }
}
