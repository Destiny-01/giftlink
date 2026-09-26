import hre, { network } from "hardhat";
import { ethers } from "ethers";
import assert from "node:assert/strict";
import { buildMerkleTree } from "../lib/merkle";
import { APPROVAL_TYPES, CLAIM_REQUEST_TYPES, consentDigest, domain } from "../lib/eip712";

/**
 * Reproducible end-to-end coordination example.
 *
 * It exercises the whole Claim Core lifecycle with three independently generated
 * signing keys — the issuer approver, the Nomine Resolver, and the claimant — none
 * of which is ever read from configuration or printed. Only addresses appear in the
 * output. The claimant and both approvers never pay gas; a separate relayer sponsors
 * the single settlement transaction.
 *
 * Run it with `npm run example` on the in-process network. The escrowed asset here is
 * a test USDC stand-in so the run is self-contained; a real deployment uses the Arc
 * USDC address from config/arc.ts.
 */

const DECIMALS = 6n;
const ALLOCATION = 25n * 10n ** DECIMALS; // 25 USDC per entitlement
const ENTITLEMENT_COUNT = 5;
const DAY = 86400n;

/** Compact stand-in for the coordination service's workflow state. */
type ConfirmationStatus = "Awaiting consent" | "Awaiting issuer confirmation" | "Ready to submit" | "Settled";

function statusOf(approvals: { consent: boolean; issuer: boolean; resolver: boolean; settled: boolean }): ConfirmationStatus {
  if (approvals.settled) return "Settled";
  if (!approvals.consent) return "Awaiting consent";
  if (!approvals.issuer || !approvals.resolver) return "Awaiting issuer confirmation";
  return "Ready to submit";
}

async function increaseTime(seconds: bigint) {
  await network.provider.send("evm_increaseTime", [Number(seconds)]);
  await network.provider.send("evm_mine");
}

async function main() {
  const [deployer, issuer, relayer] = await hre.ethers.getSigners();

  // Independent keys generated for this run. In production the issuer approver key
  // lives in the issuer's own environment and the Resolver key in Nomine's; neither
  // belongs in this repository or in any log.
  const issuerApprover = ethers.Wallet.createRandom();
  const resolver = ethers.Wallet.createRandom();
  const claimant = ethers.Wallet.createRandom();

  console.log("Actors (addresses only; no private key is printed or stored)");
  console.log(`  issuer (funder + recovery destination) ${issuer.address}`);
  console.log(`  issuer approver     ${issuerApprover.address}`);
  console.log(`  resolver            ${resolver.address}`);
  console.log(`  claimant wallet     ${claimant.address}`);
  console.log(`  relayer (sponsor)   ${relayer.address}\n`);

  const usdc: any = await (await hre.ethers.getContractFactory("MockUSDC")).deploy();
  const usdcAddress = await usdc.getAddress();
  const core: any = await (await hre.ethers.getContractFactory("NomineClaimCore")).deploy(usdcAddress);
  const coreAddress = await core.getAddress();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  console.log(`MockUSDC (test stand-in) ${usdcAddress}`);
  console.log(`NomineClaimCore          ${coreAddress}`);
  console.log(`chain ID                 ${chainId}\n`);

  // --- 1. The issuer lists entitlements and commits to them at funding ---------
  const campaignSalt = ethers.hexlify(ethers.randomBytes(16));
  const identifiers = Array.from({ length: ENTITLEMENT_COUNT }, (_, index) =>
    ethers.keccak256(ethers.toUtf8Bytes(`nomine:entitlement:${campaignSalt}:${index}`)),
  );
  const tree = buildMerkleTree(identifiers);
  console.log("1. Funding an immutable, fully backed campaign");
  console.log(`   listed entitlements ${tree.identifiers.length}, allocation ${ethers.formatUnits(ALLOCATION, 6)} USDC each`);
  console.log(`   membership commitment ${tree.root}`);
  console.log(`   example entitlement id (opaque) ${tree.identifiers[0]}\n`);

  const now = BigInt((await hre.ethers.provider.getBlock("latest"))!.timestamp);
  const openingTime = now;
  const expiryTime = now + 30n * DAY;

  const budget = BigInt(tree.identifiers.length) * ALLOCATION;
  await usdc.mint(issuer.address, budget);
  await usdc.connect(issuer).approve(coreAddress, budget);
  // The count and the commitment are derived from the supplied set; the caller cannot
  // fund fewer entitlements than it lists.
  await core.connect(issuer).createCampaign({
    issuerApprover: issuerApprover.address,
    resolver: resolver.address,
    allocation: ALLOCATION,
    openingTime,
    expiryTime,
    entitlementIds: tree.identifiers,
  });
  const campaignId = await core.campaignCount();
  const escrow = await usdc.balanceOf(coreAddress);
  console.log(`   campaign ${campaignId} funded with ${ethers.formatUnits(escrow, 6)} USDC in escrow\n`);

  // --- 2. Off-chain verification and the claimant's consent --------------------
  // The issuer independently verifies that the entitlement belongs to this claimant's
  // wallet through a known channel: that check happens outside Nomine and is not
  // something the contract can perform.
  const entitlementId = tree.identifiers[0];
  const request = {
    campaignId,
    entitlementId,
    wallet: claimant.address,
    amount: ALLOCATION,
    deadline: expiryTime,
  };

  const signerDomain = domain(chainId, coreAddress);
  const consent = consentDigest(signerDomain, request);

  // The interface has disclosed the confirmation requirement, and the claimant now
  // consents to this exact payout.
  const claimantSignature = await claimant.signTypedData(signerDomain, CLAIM_REQUEST_TYPES, request);
  let status = statusOf({ consent: true, issuer: false, resolver: false, settled: false });
  console.log("2. Claimant consent and the pending workspace state");
  console.log(`   workflow status: ${status}`);
  console.log("   (a workflow status, not a settled receipt; expiry still applies while pending)\n");

  // --- 3. Both independent attestations over the same signed request -----------
  const approval = { ...request, consentDigest: consent };
  const issuerSignature = await issuerApprover.signTypedData(signerDomain, APPROVAL_TYPES, approval);
  status = statusOf({ consent: true, issuer: true, resolver: false, settled: false });
  console.log(`3. Issuer approved the exact signed request; status: ${status}`);
  const resolverSignature = await resolver.signTypedData(signerDomain, APPROVAL_TYPES, approval);
  status = statusOf({ consent: true, issuer: true, resolver: true, settled: false });
  console.log(`   Resolver attested the same request; status: ${status}\n`);

  // --- 4. Sponsored submission and canonical receipt ---------------------------
  const proof = tree.proof(entitlementId);
  const settlementTx = await core
    .connect(relayer)
    .settle(request, claimantSignature, approval, issuerSignature, resolverSignature, proof);
  const receipt = await settlementTx.wait();

  let settled: any;
  for (const log of receipt!.logs) {
    try {
      const parsed = core.interface.parseLog(log);
      if (parsed?.name === "Settlement") settled = parsed.args;
    } catch {
      // not one of ours
    }
  }
  assert.ok(settled, "Settlement event missing");
  const claimantBalance = await usdc.balanceOf(claimant.address);
  assert.equal(claimantBalance, ALLOCATION, "claimant did not receive exactly the allocation");
  assert.equal(await core.isEntitlementConsumed(campaignId, entitlementId), true);

  console.log("4. Sponsored settlement (blockchain is the receipt)");
  console.log(`   tx ${receipt!.hash}`);
  console.log(`   settlement event: campaign ${settled.campaignId}, entitlement ${settled.entitlementId}`);
  console.log(`   paid ${ethers.formatUnits(settled.amount, 6)} USDC to ${settled.wallet} (submitter ${settled.submitter})`);
  console.log(`   total paid ${ethers.formatUnits(claimantBalance, 6)} USDC\n`);

  // --- 5. The refusals the design depends on ----------------------------------
  console.log("5. Adversarial checks");
  await refuses("one authority acting alone", () =>
    core
      .connect(relayer)
      .settle(request, claimantSignature, approval, issuerSignature, issuerSignature, proof),
  );
  await refuses("replaying a settled entitlement request", () =>
    core
      .connect(relayer)
      .settle(request, claimantSignature, approval, issuerSignature, resolverSignature, proof),
  );
  await refuses("a fabricated entitlement", async () => {
    const fabricated = ethers.keccak256(ethers.toUtf8Bytes("not-listed"));
    const fabricatedRequest = { ...request, entitlementId: fabricated };
    const fabricatedConsent = consentDigest(signerDomain, fabricatedRequest);
    const fabricatedApproval = { ...fabricatedRequest, consentDigest: fabricatedConsent };
    return core
      .connect(relayer)
      .settle(
        fabricatedRequest,
        await claimant.signTypedData(signerDomain, CLAIM_REQUEST_TYPES, fabricatedRequest),
        fabricatedApproval,
        await issuerApprover.signTypedData(signerDomain, APPROVAL_TYPES, fabricatedApproval),
        await resolver.signTypedData(signerDomain, APPROVAL_TYPES, fabricatedApproval),
        [],
      );
  });
  console.log();

  // --- 6. Reconstruct core state from canonical events ------------------------
  const fundedEvents = await core.queryFilter(core.filters.CampaignFunded(), 0, "latest");
  const settlementEvents = await core.queryFilter(core.filters.Settlement(), 0, "latest");
  const fundedTotal = fundedEvents.reduce((sum: bigint, e: any) => sum + (e.args.fundedAmount as bigint), 0n);
  const settledTotal = settlementEvents.reduce((sum: bigint, e: any) => sum + (e.args.amount as bigint), 0n);
  const consumed = new Set(settlementEvents.map((e: any) => e.args.entitlementId as string));
  console.log("6. State reconstructed from events alone");
  console.log(`   funded ${ethers.formatUnits(fundedTotal, 6)} USDC`);
  console.log(`   settled ${ethers.formatUnits(settledTotal, 6)} USDC`);
  console.log(`   remaining ${ethers.formatUnits(fundedTotal - settledTotal, 6)} USDC`);
  console.log(`   consumed entitlements ${consumed.size}\n`);

  // --- 7. Expiry recovery without either Gate signer --------------------------
  await increaseTime(expiryTime - BigInt((await hre.ethers.provider.getBlock("latest"))!.timestamp) + 1n);
  console.log("7. After expiry");
  const lateRequest = { ...request, entitlementId: tree.identifiers[1], deadline: expiryTime + DAY };
  const lateConsent = consentDigest(signerDomain, lateRequest);
  const lateApproval = { ...lateRequest, consentDigest: lateConsent };
  const lateClaimantSignature = await claimant.signTypedData(signerDomain, CLAIM_REQUEST_TYPES, lateRequest);
  const lateIssuerSignature = await issuerApprover.signTypedData(signerDomain, APPROVAL_TYPES, lateApproval);
  const lateResolverSignature = await resolver.signTypedData(signerDomain, APPROVAL_TYPES, lateApproval);
  await refuses("settlement after expiry", () =>
    core
      .connect(relayer)
      .settle(
        lateRequest,
        lateClaimantSignature,
        lateApproval,
        lateIssuerSignature,
        lateResolverSignature,
        tree.proof(tree.identifiers[1]),
      ),
  );

  const recoveryBefore = await usdc.balanceOf(issuer.address);
  // No claimant consent and no Gate signature is involved in reclaim, and the
  // destination is the issuer fixed at funding.
  await core.connect(issuer).reclaim(campaignId);
  const recovered = (await usdc.balanceOf(issuer.address)) - recoveryBefore;
  assert.equal(recovered, (BigInt(tree.identifiers.length) - 1n) * ALLOCATION, "reclaim did not return the unused balance");
  assert.equal(await usdc.balanceOf(coreAddress), 0n, "escrow not emptied");
  assert.equal(await usdc.balanceOf(claimant.address), ALLOCATION, "settled funds were disturbed");

  console.log(`   unused balance returned to the issuer: ${ethers.formatUnits(recovered, 6)} USDC`);
  console.log(`   settled allocation untouched: ${ethers.formatUnits(await usdc.balanceOf(claimant.address), 6)} USDC`);
  console.log(`   escrow after reclaim: ${ethers.formatUnits(await usdc.balanceOf(coreAddress), 6)} USDC`);
  console.log(`   reclaim required neither Gate signer nor claimant consent\n`);
  console.log("✔ Lifecycle complete.");
}

async function refuses(label: string, action: () => Promise<unknown>) {
  try {
    await action();
    console.log(`   ✖ ${label}: unexpectedly succeeded`);
    process.exitCode = 1;
  } catch (error) {
    // Only a revert counts as the demonstration. Any other failure (a bad ABI, a
    // network error) must not be printed as if the on-chain rule refused the call.
    const reverted =
      typeof error === "object" &&
      error !== null &&
      ((error as { code?: string }).code === "CALL_EXCEPTION" || "revert" in error || "data" in error);
    if (!reverted) {
      console.log(`   ✖ ${label}: failed for an unexpected reason: ${String(error)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`   ✔ ${label}: refused on-chain`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
