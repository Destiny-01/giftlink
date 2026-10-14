import { Interface } from "ethers";

/**
 * Nomine Claim Core ABI, copied verbatim from `link-contracts/abi/NomineClaimCore.json`.
 *
 * Unlike `config/abi.ts` (which is hand-written from a contract with no compiled artefact),
 * this deployment ships a real ABI, so the exact fragment list is reproduced here -
 * including the custom `error` entries, which is what lets `Interface.parseError` name a
 * revert this contract defines rather than treating every failure as opaque.
 *
 * Keep it in step with `link-contracts/contracts/NomineClaimCore.sol`. A member that is
 * missing here fails loudly at call time rather than silently reading the wrong storage
 * slot, and `services/claimCoreEvidence.ts` refuses to authorize anything when the
 * configured address does not answer the views this ABI declares.
 *
 * `docs/nomine-claim-core-integration.md` §1 is the source of truth for the deployment.
 */
export const NomineClaimCoreABI = [
  {
    "inputs": [{ "internalType": "address", "name": "usdc_", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "provided", "type": "uint256" },
      { "internalType": "uint128", "name": "allocation", "type": "uint128" }
    ],
    "name": "AmountNotAllocation",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "uint64", "name": "deadline", "type": "uint64" },
      { "internalType": "uint256", "name": "nowTimestamp", "type": "uint256" }
    ],
    "name": "ApprovalExpired",
    "type": "error"
  },
  { "inputs": [], "name": "ApprovalMismatch", "type": "error" },
  { "inputs": [], "name": "AuthoritiesNotDistinct", "type": "error" },
  {
    "inputs": [
      { "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "internalType": "uint64", "name": "expiryTime", "type": "uint64" },
      { "internalType": "uint256", "name": "nowTimestamp", "type": "uint256" }
    ],
    "name": "CampaignExpired",
    "type": "error"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "CampaignNotFound",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "internalType": "uint64", "name": "openingTime", "type": "uint64" },
      { "internalType": "uint256", "name": "nowTimestamp", "type": "uint256" }
    ],
    "name": "CampaignNotOpen",
    "type": "error"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "CampaignReclaimedAlready",
    "type": "error"
  },
  { "inputs": [], "name": "ECDSAInvalidSignature", "type": "error" },
  {
    "inputs": [{ "internalType": "uint256", "name": "length", "type": "uint256" }],
    "name": "ECDSAInvalidSignatureLength",
    "type": "error"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "s", "type": "bytes32" }],
    "name": "ECDSAInvalidSignatureS",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "internalType": "bytes32", "name": "entitlementId", "type": "bytes32" }
    ],
    "name": "EntitlementAlreadyConsumed",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "internalType": "uint32", "name": "entitlementCount", "type": "uint32" }
    ],
    "name": "EntitlementCountReached",
    "type": "error"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "EntitlementNotListed",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "expected", "type": "uint256" },
      { "internalType": "uint256", "name": "received", "type": "uint256" }
    ],
    "name": "FundingAmountMismatch",
    "type": "error"
  },
  { "inputs": [], "name": "InvalidClaimantConsent", "type": "error" },
  { "inputs": [], "name": "InvalidEntitlementSet", "type": "error" },
  { "inputs": [], "name": "InvalidIssuerApproval", "type": "error" },
  { "inputs": [], "name": "InvalidResolverApproval", "type": "error" },
  { "inputs": [], "name": "InvalidShortString", "type": "error" },
  {
    "inputs": [
      { "internalType": "uint64", "name": "openingTime", "type": "uint64" },
      { "internalType": "uint64", "name": "expiryTime", "type": "uint64" }
    ],
    "name": "InvalidWindow",
    "type": "error"
  },
  {
    "inputs": [{ "internalType": "address", "name": "issuer", "type": "address" }],
    "name": "IssuerIsAnApprover",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "internalType": "uint64", "name": "expiryTime", "type": "uint64" },
      { "internalType": "uint256", "name": "nowTimestamp", "type": "uint256" }
    ],
    "name": "NotExpired",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "caller", "type": "address" },
      { "internalType": "address", "name": "issuer", "type": "address" }
    ],
    "name": "NotIssuer",
    "type": "error"
  },
  { "inputs": [], "name": "ReentrancyGuardReentrantCall", "type": "error" },
  {
    "inputs": [{ "internalType": "address", "name": "token", "type": "address" }],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "inputs": [{ "internalType": "string", "name": "str", "type": "string" }],
    "name": "StringTooLong",
    "type": "error"
  },
  { "inputs": [], "name": "ZeroAddress", "type": "error" },
  { "inputs": [], "name": "ZeroValue", "type": "error" },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "issuer", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "issuerApprover", "type": "address" },
      { "indexed": false, "internalType": "address", "name": "resolver", "type": "address" },
      { "indexed": false, "internalType": "uint128", "name": "allocation", "type": "uint128" },
      { "indexed": false, "internalType": "uint32", "name": "entitlementCount", "type": "uint32" },
      { "indexed": false, "internalType": "uint256", "name": "fundedAmount", "type": "uint256" },
      { "indexed": false, "internalType": "uint64", "name": "openingTime", "type": "uint64" },
      { "indexed": false, "internalType": "uint64", "name": "expiryTime", "type": "uint64" },
      { "indexed": false, "internalType": "bytes32", "name": "entitlementRoot", "type": "bytes32" }
    ],
    "name": "CampaignFunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "issuer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "CampaignReclaimed",
    "type": "event"
  },
  { "anonymous": false, "inputs": [], "name": "EIP712DomainChanged", "type": "event" },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "indexed": true, "internalType": "bytes32", "name": "entitlementId", "type": "bytes32" },
      { "indexed": true, "internalType": "address", "name": "wallet", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "indexed": false, "internalType": "address", "name": "submitter", "type": "address" }
    ],
    "name": "Settlement",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "APPROVAL_TYPEHASH",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "CLAIM_REQUEST_TYPEHASH",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "USDC",
    "outputs": [{ "internalType": "contract IERC20", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "budgetOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "campaignCount",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "issuerApprover", "type": "address" },
          { "internalType": "address", "name": "resolver", "type": "address" },
          { "internalType": "uint128", "name": "allocation", "type": "uint128" },
          { "internalType": "uint64", "name": "openingTime", "type": "uint64" },
          { "internalType": "uint64", "name": "expiryTime", "type": "uint64" },
          { "internalType": "bytes32[]", "name": "entitlementIds", "type": "bytes32[]" }
        ],
        "internalType": "struct NomineClaimCore.CampaignConfig",
        "name": "config",
        "type": "tuple"
      }
    ],
    "name": "createCampaign",
    "outputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712Domain",
    "outputs": [
      { "internalType": "bytes1", "name": "fields", "type": "bytes1" },
      { "internalType": "string", "name": "name", "type": "string" },
      { "internalType": "string", "name": "version", "type": "string" },
      { "internalType": "uint256", "name": "chainId", "type": "uint256" },
      { "internalType": "address", "name": "verifyingContract", "type": "address" },
      { "internalType": "bytes32", "name": "salt", "type": "bytes32" },
      { "internalType": "uint256[]", "name": "extensions", "type": "uint256[]" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "getCampaign",
    "outputs": [
      {
        "components": [
          { "internalType": "address", "name": "issuer", "type": "address" },
          { "internalType": "address", "name": "issuerApprover", "type": "address" },
          { "internalType": "address", "name": "resolver", "type": "address" },
          { "internalType": "uint128", "name": "allocation", "type": "uint128" },
          { "internalType": "uint32", "name": "entitlementCount", "type": "uint32" },
          { "internalType": "uint32", "name": "settlementCount", "type": "uint32" },
          { "internalType": "uint64", "name": "openingTime", "type": "uint64" },
          { "internalType": "uint64", "name": "expiryTime", "type": "uint64" },
          { "internalType": "bytes32", "name": "entitlementRoot", "type": "bytes32" },
          { "internalType": "bool", "name": "reclaimed", "type": "bool" }
        ],
        "internalType": "struct NomineClaimCore.Campaign",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "campaignId", "type": "uint256" },
      { "internalType": "bytes32", "name": "entitlementId", "type": "bytes32" }
    ],
    "name": "isEntitlementConsumed",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "reclaim",
    "outputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "reclaimableOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "remainingUnsettledOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          { "internalType": "uint256", "name": "campaignId", "type": "uint256" },
          { "internalType": "bytes32", "name": "entitlementId", "type": "bytes32" },
          { "internalType": "address", "name": "wallet", "type": "address" },
          { "internalType": "uint256", "name": "amount", "type": "uint256" },
          { "internalType": "uint64", "name": "deadline", "type": "uint64" }
        ],
        "internalType": "struct NomineClaimCore.ClaimRequest",
        "name": "request",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "claimantSignature", "type": "bytes" },
      {
        "components": [
          { "internalType": "uint256", "name": "campaignId", "type": "uint256" },
          { "internalType": "bytes32", "name": "entitlementId", "type": "bytes32" },
          { "internalType": "address", "name": "wallet", "type": "address" },
          { "internalType": "uint256", "name": "amount", "type": "uint256" },
          { "internalType": "uint64", "name": "deadline", "type": "uint64" },
          { "internalType": "bytes32", "name": "consentDigest", "type": "bytes32" }
        ],
        "internalType": "struct NomineClaimCore.Approval",
        "name": "approval",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "issuerApprovalSignature", "type": "bytes" },
      { "internalType": "bytes", "name": "resolverApprovalSignature", "type": "bytes" },
      { "internalType": "bytes32[]", "name": "entitlementProof", "type": "bytes32[]" }
    ],
    "name": "settle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "campaignId", "type": "uint256" }],
    "name": "settledAmountOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

/**
 * Shared interface for decoding logs and encoding calls for the configured Claim Core
 * deployment. The JSON above is a full ABI (constructor, views, writes, events and custom
 * errors), so `parseLog`, `parseError`, `encodeEventLog` and the generated getters/filters
 * all work off this one instance.
 */
export const nomineClaimCoreInterface = new Interface(NomineClaimCoreABI);

/** The only canonical evidence events, by name. Nothing else may be treated as settlement. */
export const CLAIM_CORE_EVENTS = {
  CAMPAIGN_FUNDED: "CampaignFunded",
  SETTLEMENT: "Settlement",
  CAMPAIGN_RECLAIMED: "CampaignReclaimed",
} as const;
