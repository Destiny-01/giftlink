import { Interface } from "ethers";

/**
 * GiftLink contract ABI, derived by hand from `contracts/GiftLink.sol`.
 *
 * The previous file in this location was an explicitly-labelled placeholder from a
 * different contract generation: its `DropCreated`/`DropClaimed`/`DropRevoked` event
 * signatures had different parameter lists, so their topic hashes could never match a
 * real log, and only `claimWithPermit` happened to coincide.
 *
 * There is no compiled artefact and no deploy tooling in this repository, so the ABI
 * cannot be generated from one. It is therefore written out in full and kept honest by
 * runtime assertions instead of assumption: `assertContractConfiguration` and
 * `assertDropMatchesChain` in `services/chainEvidence.ts` refuse to authorize anything
 * when the configured address does not behave like this contract. The deployment
 * question itself stays recorded as unknown in the audit (§3, unknowns 1-2).
 *
 * Keep every entry in step with `contracts/GiftLink.sol`. A member that is missing here
 * fails loudly at call time rather than silently reading the wrong storage slot.
 */
export const GiftLinkABI = [
  // --- Creation ---
  "function createDrop(uint128 amount, uint128 gasTankAmount, bytes32 recipientCommit, uint8 recipientType, uint64 expiry) returns (uint256)",

  // --- Claiming ---
  "function claimWithPermit(uint256 dropId, address claimer, uint64 permitExpiry, bytes signature) returns (bool)",
  "function claimPublic(uint256 dropId, address claimer) returns (bool)",

  // --- Management ---
  "function revokeDrop(uint256 dropId)",
  "function updateReceiver(uint256 dropId, bytes32 newRecipientCommit)",
  "function markExpired(uint256 dropId)",

  // --- Views ---
  "function getDrop(uint256 dropId) view returns (address sender, uint128 amount, uint128 gasTankAmount, bytes32 recipientCommit, uint8 recipientType, uint8 status, uint64 expiry, uint64 createdAt)",
  "function dropCount() view returns (uint256)",
  "function getDropsBySender(address sender) view returns (uint256[])",
  "function getContractBalance() view returns (uint256)",
  "function USDC() view returns (address)",
  "function backendSigner() view returns (address)",
  "function defaultGasTankAmount() view returns (uint128)",
  "function owner() view returns (address)",

  // --- Events ---
  "event DropCreated(uint256 indexed dropId, address indexed sender, uint128 amount, uint128 gasTankAmount, bytes32 recipientCommit, uint8 recipientType, uint64 expiry)",
  "event DropClaimed(uint256 indexed dropId, address indexed claimer, address indexed relayer, uint128 amountToClaimer, uint128 amountToRelayer)",
  "event DropRevoked(uint256 indexed dropId, address indexed sender, uint128 totalRefunded)",
  "event ReceiverUpdated(uint256 indexed dropId, bytes32 oldCommit, bytes32 newCommit)",
  "event BackendSignerUpdated(address indexed oldSigner, address indexed newSigner)",
  "event DefaultGasTankUpdated(uint128 oldAmount, uint128 newAmount)",
] as const;

/** Shared interface for decoding logs emitted by the configured contract. */
export const giftLinkInterface = new Interface([...GiftLinkABI]);

/** On-chain `status` values from `GiftLink.sol`. */
export const ONCHAIN_DROP_STATUS = {
  ACTIVE: 0,
  CLAIMED: 1,
  REVOKED: 2,
  EXPIRED: 3,
} as const;

/** On-chain `recipientType` values from `GiftLink.sol`. */
export const ONCHAIN_RECIPIENT_TYPE = {
  PUBLIC: 0,
  EMAIL: 1,
  DISCORD: 2,
  TWITTER: 3,
  WALLET: 4,
} as const;
