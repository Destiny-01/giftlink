import { Contract, JsonRpcProvider } from "ethers";
import type { Log, TransactionReceipt } from "ethers";
import type { Drop } from "@prisma/client";
import { env, legacyGiftLinkAddress } from "../config/env";
import {
  GiftLinkABI,
  giftLinkInterface,
  ONCHAIN_DROP_STATUS,
} from "../config/abi";
import { getRpcProvider } from "../config/arcClient";
import { backendSigner } from "../config/wallets";
import {
  dropAmountToBaseUnits,
  recipientTypeToNumber,
  recipientTypeToString,
} from "../utils/drop";
import {
  ChainEvidenceError,
  ConfigurationError,
  ValidationError,
} from "../utils/errors";

/**
 * Chain-authoritative verification.
 *
 * D-004 makes on-chain state and canonical events authoritative for funding,
 * availability, settlement, expiry and recovery. Everything a caller can assert about a
 * transaction is treated here as a claim to be checked against the configured contract:
 * the network, the emitting address, the decoded event, the gift id inside it, and the
 * payout facts it reports.
 *
 * Nothing in this module trusts request data. Where the database and the chain disagree,
 * it refuses to proceed with a diagnostic rather than reconciling them silently.
 */

export interface DeployedContractView {
  usdcAddress: string;
  backendSignerAddress: string;
}

export interface SettlementFacts {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  onchainId: bigint;
  claimer: string;
  relayer: string;
  amountToClaimer: bigint;
  amountToRelayer: bigint;
}

export interface CreationFacts {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  onchainId: bigint;
  sender: string;
  amount: bigint;
  gasTankAmount: bigint;
  recipientCommit: string;
  recipientType: number;
  expiry: bigint;
}

/**
 * How long a successful deployment check is reused. The contract's `backendSigner` can be
 * rotated by the owner, and a cache with no expiry would keep answering from the old value
 * and sign permits the contract then rejects. A short window bounds that staleness while
 * still keeping the check off the hot path.
 */
const CONTRACT_VIEW_TTL_MS = 5 * 60 * 1000;

let contractViewCache: { view: DeployedContractView; fetchedAt: number } | null =
  null;

/** Clears the cached deployment check. Used by tests and by configuration reloads. */
export function resetContractViewCache(): void {
  contractViewCache = null;
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Confirms the configured address really is this contract generation and that it is the
 * one this service is configured to trust.
 *
 * The two immutable/public values it reads are the strongest cheap fingerprints
 * available here: a different contract generation either lacks them or reports
 * different values. This is what makes the ABI in `config/abi.ts` a checked assumption
 * rather than a hopeful one, and it is why a misconfigured deployment fails closed.
 */
export async function assertContractConfiguration(
  provider: JsonRpcProvider = getRpcProvider()
): Promise<DeployedContractView> {
  if (
    contractViewCache &&
    Date.now() - contractViewCache.fetchedAt < CONTRACT_VIEW_TTL_MS
  ) {
    return contractViewCache.view;
  }

  const contract = new Contract(
    legacyGiftLinkAddress(),
    GiftLinkABI,
    provider
  );

  let usdcAddress: string;
  let signerAddress: string;
  try {
    usdcAddress = String(await contract.USDC());
    signerAddress = String(await contract.backendSigner());
  } catch (error) {
    throw new ConfigurationError(
      `The configured contract at ${legacyGiftLinkAddress()} does not answer USDC()/backendSigner(). ` +
        "It is probably a different contract generation than link-backend/contracts/GiftLink.sol, or the address/network is wrong. " +
        "Refusing to authorize anything against it."
    );
  }

  if (normalizeAddress(usdcAddress) !== normalizeAddress(env.USDC_CONTRACT_ADDRESS)) {
    throw new ConfigurationError(
      `Deployment mismatch: contract ${legacyGiftLinkAddress()} settles ${usdcAddress}, ` +
        `but USDC_CONTRACT_ADDRESS is ${env.USDC_CONTRACT_ADDRESS}. Refusing to authorize settlements.`
    );
  }

  if (normalizeAddress(signerAddress) !== normalizeAddress(backendSigner.address)) {
    throw new ConfigurationError(
      `Deployment mismatch: contract ${legacyGiftLinkAddress()} trusts backend signer ${signerAddress}, ` +
        `but this service signs with ${backendSigner.address}. Permits it issues would be rejected. Refusing to sign.`
    );
  }

  contractViewCache = {
    view: {
      usdcAddress: normalizeAddress(usdcAddress),
      backendSignerAddress: normalizeAddress(signerAddress),
    },
    fetchedAt: Date.now(),
  };
  return contractViewCache.view;
}

/** Confirms the RPC endpoint is the chain this service is configured for. */
export async function assertConfiguredNetwork(
  provider: JsonRpcProvider = getRpcProvider()
): Promise<void> {
  let chainId: bigint;
  try {
    const network = await provider.getNetwork();
    chainId = network.chainId;
  } catch (error) {
    throw new ConfigurationError(
      `Unable to read the chain id from RPC_URL. Settlement cannot be verified against CHAIN_ID=${env.CHAIN_ID}.`
    );
  }

  if (chainId !== BigInt(env.CHAIN_ID)) {
    throw new ConfigurationError(
      `RPC_URL reports chain id ${chainId}, but CHAIN_ID is ${env.CHAIN_ID}. ` +
        "Refusing to verify settlement against the wrong network."
    );
  }
}

export interface OnchainGiftView {
  status: number;
  sender: string;
  amount: bigint;
  gasTankAmount: bigint;
  recipientCommit: string;
  recipientType: number;
  expiry: bigint;
}

/**
 * Reads the contract's own record of a gift.
 *
 * This is the authoritative view used both to compare against the database before
 * authorizing, and to check a settlement's reported amount against the gift it claims to
 * settle.
 */
export async function readGift(
  onchainId: bigint,
  provider: JsonRpcProvider = getRpcProvider()
): Promise<OnchainGiftView> {
  const contract = new Contract(
    legacyGiftLinkAddress(),
    GiftLinkABI,
    provider
  );

  let onchain;
  try {
    onchain = await contract.getDrop(onchainId);
  } catch (error) {
    throw new ConfigurationError(
      `Unable to read gift ${onchainId.toString()} from the configured contract ` +
        `${legacyGiftLinkAddress()}. Refusing to proceed against unverifiable chain state.`
    );
  }

  return {
    status: Number(onchain.status),
    sender: String(onchain.sender),
    amount: BigInt(onchain.amount),
    gasTankAmount: BigInt(onchain.gasTankAmount),
    recipientCommit: String(onchain.recipientCommit),
    recipientType: Number(onchain.recipientType),
    expiry: BigInt(onchain.expiry),
  };
}

/**
 * Compares the stored gift against the contract's own record of it, and returns what the
 * chain says.
 *
 * This is the check that stops the backend authorizing from contradictory data: if the
 * database, the configured ABI and the contract disagree about the gift's recipient
 * rules, sender, amount or window, authorization stops here with a diagnostic instead
 * of proceeding on whichever copy happens to be local.
 */
export async function assertDropMatchesChain(
  drop: Pick<
    Drop,
    | "onchainId"
    | "senderAddress"
    | "amount"
    | "gasTankAmount"
    | "recipientCommit"
    | "recipientType"
    | "expiry"
  >,
  provider: JsonRpcProvider = getRpcProvider()
): Promise<OnchainGiftView> {
  if (drop.onchainId === null || drop.onchainId === undefined) {
    throw new ValidationError("Gift is not confirmed on-chain yet");
  }

  const onchain = await readGift(drop.onchainId, provider);

  const disagreements: string[] = [];

  const sender = normalizeAddress(String(onchain.sender));
  if (sender !== normalizeAddress(drop.senderAddress)) {
    disagreements.push(
      `sender (chain ${sender}, database ${normalizeAddress(drop.senderAddress)})`
    );
  }

  if (String(onchain.amount) !== dropAmountToBaseUnits(drop.amount).toString()) {
    disagreements.push(
      `amount (chain ${String(onchain.amount)} base units, database ${drop.amount} USDC)`
    );
  }

  if (
    drop.gasTankAmount != null &&
    String(onchain.gasTankAmount) !== drop.gasTankAmount
  ) {
    disagreements.push(
      `gas tank (chain ${String(
        onchain.gasTankAmount
      )}, database ${drop.gasTankAmount})`
    );
  }

  if (normalizeAddress(String(onchain.recipientCommit)) !== normalizeAddress(drop.recipientCommit)) {
    disagreements.push(
      `recipient commitment (chain ${String(
        onchain.recipientCommit
      )}, database ${drop.recipientCommit})`
    );
  }

  const expectedType = recipientTypeToNumber(drop.recipientType);
  if (Number(onchain.recipientType) !== expectedType) {
    disagreements.push(
      `recipient type (chain ${Number(
        onchain.recipientType
      )}, database ${expectedType} for ${recipientTypeToString(
        drop.recipientType
      )})`
    );
  }

  const expectedExpiry = drop.expiry
    ? BigInt(Math.floor(drop.expiry.getTime() / 1000))
    : 0n;
  if (BigInt(onchain.expiry) !== expectedExpiry) {
    disagreements.push(
      `expiry (chain ${String(onchain.expiry)}, database ${expectedExpiry.toString()})`
    );
  }

  if (disagreements.length > 0) {
    throw new ConfigurationError(
      `Gift ${drop.onchainId.toString()} disagrees between the database and the configured contract ` +
        `(${disagreements.join("; ")}). Refusing to authorize a payout from contradictory data. ` +
        "Resolve the mismatch deliberately; the backend does not rewrite on-chain commitments."
    );
  }

  return onchain;
}

/**
 * Finds the settlement the contract already recorded for a gift.
 *
 * This is how a claim that succeeded on-chain but never got a response is reconciled
 * instead of being paid twice: the caller retries, the contract reports the gift as
 * already claimed, and the existing canonical event supplies the facts.
 */
export async function findSettlementForGift(
  onchainId: bigint,
  provider: JsonRpcProvider = getRpcProvider(),
  fromBlock = 0
): Promise<SettlementFacts | null> {
  const contract = new Contract(
    legacyGiftLinkAddress(),
    GiftLinkABI,
    provider
  );

  let logs;
  try {
    logs = await contract.queryFilter(
      contract.filters.DropClaimed(onchainId),
      fromBlock,
      "latest"
    );
  } catch (error) {
    throw new ConfigurationError(
      `Unable to read settlement events for gift ${onchainId.toString()} from the configured contract. ` +
        "Refusing to reconcile a settled gift without chain evidence."
    );
  }

  if (!logs || logs.length === 0) {
    return null;
  }

  if (logs.length > 1) {
    const distinct = new Set(logs.map((log) => log.transactionHash));
    if (distinct.size > 1) {
      throw new ConfigurationError(
        `Gift ${onchainId.toString()} has more than one settlement event on-chain. ` +
          "Refusing to reconcile an ambiguous settlement."
      );
    }
  }

  // Reuse the same matcher the receipt path uses, rather than a second, weaker one: the
  // address filter, the event check and the conflict rejection must behave identically
  // however the settlement was found.
  const txHash = logs[0].transactionHash;
  return extractSettlement(
    {
      hash: txHash,
      status: 1,
      blockNumber: logs[0].blockNumber,
      logs: logs.filter((log) => log.transactionHash === txHash),
    } as unknown as TransactionReceipt,
    { contractAddress: legacyGiftLinkAddress(), onchainId }
  );
}

/**
 * Block timestamp for a settlement, so the recorded time comes from the chain rather
 * than the server clock. Falls back to null when the block cannot be read.
 */
export async function getBlockTimestamp(
  blockNumber: number,
  provider: JsonRpcProvider = getRpcProvider()
): Promise<Date | null> {
  try {
    const block = await provider.getBlock(blockNumber);
    if (block && typeof block.timestamp === "number") {
      return new Date(block.timestamp * 1000);
    }
  } catch {
    // Non-fatal: the caller falls back to the server clock.
  }
  return null;
}

function findContractLogs(
  receipt: TransactionReceipt,
  contractAddress: string
): Log[] {
  const expected = normalizeAddress(contractAddress);
  return receipt.logs.filter(
    (log) => normalizeAddress(log.address) === expected
  );
}

/**
 * Extracts a verified settlement from a receipt: the canonical `DropClaimed` event
 * emitted by the configured contract, for this gift.
 *
 * A successful receipt is not evidence on its own. The caller-supplied hash must resolve
 * to a confirmed transaction whose logs contain this contract's settlement event for
 * this gift id; the payout facts come from that event, never from the request.
 */
export function extractSettlement(
  receipt: TransactionReceipt,
  expected: { contractAddress: string; onchainId: bigint }
): SettlementFacts {
  if (!receipt || receipt.status !== 1) {
    throw new ValidationError("Transaction failed or is not confirmed");
  }

  const contractLogs = findContractLogs(receipt, expected.contractAddress);

  if (contractLogs.length === 0) {
    throw new ChainEvidenceError(
      `Transaction ${receipt.hash} was not emitted by the configured gift contract ` +
        `${expected.contractAddress}. It cannot settle this gift.`
    );
  }

  const matches: SettlementFacts[] = [];

  for (const log of contractLogs) {
    let parsed;
    try {
      parsed = giftLinkInterface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }

    if (!parsed || parsed.name !== "DropClaimed") {
      continue;
    }

    const onchainId = BigInt(parsed.args.dropId);
    if (onchainId !== expected.onchainId) {
      continue;
    }

    matches.push({
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      logIndex: log.index,
      onchainId,
      claimer: String(parsed.args.claimer).toLowerCase(),
      relayer: String(parsed.args.relayer).toLowerCase(),
      amountToClaimer: BigInt(parsed.args.amountToClaimer),
      amountToRelayer: BigInt(parsed.args.amountToRelayer),
    });
  }

  if (matches.length === 0) {
    const sawContractEvents = contractLogs.length > 0;
    throw new ChainEvidenceError(
      `Transaction ${receipt.hash} contains no DropClaimed event for gift ` +
        `${expected.onchainId.toString()}${
          sawContractEvents
            ? " (the contract emitted other events instead)"
            : ""
        }. It does not settle this gift.`
    );
  }

  if (matches.length > 1) {
    const distinct = new Set(
      matches.map(
        (match) =>
          `${match.claimer}:${match.amountToClaimer}:${match.amountToRelayer}`
      )
    );
    if (distinct.size > 1) {
      throw new ChainEvidenceError(
        `Transaction ${receipt.hash} reports conflicting DropClaimed events for gift ` +
          `${expected.onchainId.toString()}. Refusing to record an ambiguous settlement.`
      );
    }
  }

  return matches[0];
}

/**
 * Extracts a verified creation from a receipt: the canonical `DropCreated` event emitted
 * by the configured contract, for the gift id the caller claims it created.
 */
export function extractCreation(
  receipt: TransactionReceipt,
  expected: { contractAddress: string; onchainId?: bigint }
): CreationFacts {
  if (!receipt || receipt.status !== 1) {
    throw new ValidationError("Transaction failed or is not confirmed");
  }

  const contractLogs = findContractLogs(receipt, expected.contractAddress);

  const matches: CreationFacts[] = [];

  for (const log of contractLogs) {
    let parsed;
    try {
      parsed = giftLinkInterface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }

    if (!parsed || parsed.name !== "DropCreated") {
      continue;
    }

    const onchainId = BigInt(parsed.args.dropId);
    if (expected.onchainId !== undefined && onchainId !== expected.onchainId) {
      continue;
    }

    matches.push({
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      logIndex: log.index,
      onchainId,
      sender: String(parsed.args.sender).toLowerCase(),
      amount: BigInt(parsed.args.amount),
      gasTankAmount: BigInt(parsed.args.gasTankAmount),
      recipientCommit: String(parsed.args.recipientCommit),
      recipientType: Number(parsed.args.recipientType),
      expiry: BigInt(parsed.args.expiry),
    });
  }

  if (matches.length === 0) {
    throw new ChainEvidenceError(
      `Transaction ${receipt.hash} contains no DropCreated event${
        expected.onchainId !== undefined
          ? ` for gift ${expected.onchainId.toString()}`
          : ""
      } from the configured contract ${expected.contractAddress}. It cannot confirm this gift.`
    );
  }

  if (matches.length > 1) {
    throw new ChainEvidenceError(
      `Transaction ${receipt.hash} reports more than one gift creation. ` +
        "Refusing to bind a gift from an ambiguous transaction."
    );
  }

  return matches[0];
}

/** Fetches a receipt and verifies it settles this gift. */
export async function fetchVerifiedSettlement(
  txHash: string,
  expected: { contractAddress: string; onchainId: bigint; provider?: JsonRpcProvider }
): Promise<SettlementFacts> {
  const provider = expected.provider ?? getRpcProvider();
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    throw new ValidationError(
      "Transaction is not confirmed yet. Settlement is recorded only from a confirmed transaction."
    );
  }

  return extractSettlement(receipt, expected);
}

export interface RevocationFacts {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  onchainId: bigint;
  sender: string;
  totalRefunded: bigint;
}

/**
 * Extracts a verified revocation: the canonical `DropRevoked` event emitted by the
 * configured contract for this gift.
 */
export function extractRevocation(
  receipt: TransactionReceipt,
  expected: { contractAddress: string; onchainId: bigint }
): RevocationFacts {
  if (!receipt || receipt.status !== 1) {
    throw new ValidationError("Transaction failed or is not confirmed");
  }

  const contractLogs = findContractLogs(receipt, expected.contractAddress);

  for (const log of contractLogs) {
    let parsed;
    try {
      parsed = giftLinkInterface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
    } catch {
      continue;
    }

    if (!parsed || parsed.name !== "DropRevoked") {
      continue;
    }

    const onchainId = BigInt(parsed.args.dropId);
    if (onchainId !== expected.onchainId) {
      continue;
    }

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      logIndex: log.index,
      onchainId,
      sender: String(parsed.args.sender).toLowerCase(),
      totalRefunded: BigInt(parsed.args.totalRefunded),
    };
  }

  throw new ChainEvidenceError(
    `Transaction ${receipt.hash} contains no DropRevoked event for gift ` +
      `${expected.onchainId.toString()} from the configured contract. It does not revoke this gift.`
  );
}

/** Fetches a receipt and verifies it revoked this gift. */
export async function fetchVerifiedRevocation(
  txHash: string,
  expected: { contractAddress: string; onchainId: bigint; provider?: JsonRpcProvider }
): Promise<RevocationFacts> {
  const provider = expected.provider ?? getRpcProvider();
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    throw new ValidationError(
      "Transaction is not confirmed yet. Revocation is recorded only from a confirmed transaction."
    );
  }

  return extractRevocation(receipt, expected);
}

/** Fetches a receipt and verifies it created this gift. */
export async function fetchVerifiedCreation(
  txHash: string,
  expected: { contractAddress: string; onchainId?: bigint; provider?: JsonRpcProvider }
): Promise<CreationFacts> {
  const provider = expected.provider ?? getRpcProvider();
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    throw new ValidationError(
      "Creation transaction is not confirmed yet. The gift stays pending until it is."
    );
  }

  return extractCreation(receipt, expected);
}

export { ONCHAIN_DROP_STATUS };
