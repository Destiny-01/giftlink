import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { buildMerkleTree, type MerkleTree } from "../lib/merkle";
import { APPROVAL_TYPES, CLAIM_REQUEST_TYPES, consentDigest, domain } from "../lib/eip712";

const USDC = 10n ** 6n;
const ALLOCATION = 25n * USDC;
const DAY = 86400n;

interface Fixture {
  usdc: any;
  core: any;
  coreAddress: string;
  chainId: number;
  deployer: HardhatEthersSigner;
  issuer: HardhatEthersSigner;
  issuerApprover: HardhatEthersSigner;
  resolver: HardhatEthersSigner;
  recovery: HardhatEthersSigner;
  claimant: HardhatEthersSigner;
  otherClaimant: HardhatEthersSigner;
  attacker: HardhatEthersSigner;
  relayer: HardhatEthersSigner;
}

async function deployFixture(): Promise<Fixture> {
  const [deployer, issuer, issuerApprover, resolver, recovery, claimant, otherClaimant, attacker, relayer] =
    await ethers.getSigners();

  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const core = await (await ethers.getContractFactory("NomineClaimCore")).deploy(await usdc.getAddress());
  const coreAddress = await core.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  return {
    usdc,
    core,
    coreAddress,
    chainId,
    deployer,
    issuer,
    issuerApprover,
    resolver,
    recovery,
    claimant,
    otherClaimant,
    attacker,
    relayer,
  };
}

function campaignDomain(fx: Fixture) {
  return domain(fx.chainId, fx.coreAddress);
}

async function latestTimestamp(): Promise<bigint> {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block!.timestamp);
}

async function increaseTime(seconds: bigint) {
  await network.provider.send("evm_increaseTime", [Number(seconds)]);
  await network.provider.send("evm_mine");
}

async function mineAt(timestamp: bigint) {
  await network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
}

interface CampaignHandle {
  campaignId: bigint;
  entitlementIds: string[];
  tree: MerkleTree;
  openingTime: bigint;
  expiryTime: bigint;
}

async function fundCampaign(
  fx: Fixture,
  options: {
    entitlementCount?: number;
    allocation?: bigint;
    openingTime?: bigint;
    expiryTime?: bigint;
    issuerApprover?: string;
    resolver?: string;
    recoveryDestination?: string;
    issuer?: HardhatEthersSigner;
    mintAmount?: bigint;
    approveAmount?: bigint;
  } = {},
): Promise<CampaignHandle> {
  const count = options.entitlementCount ?? 4;
  const allocation = options.allocation ?? ALLOCATION;
  const now = await latestTimestamp();
  const openingTime = options.openingTime ?? now;
  const expiryTime = options.expiryTime ?? now + 30n * DAY;
  const issuer = options.issuer ?? fx.issuer;

  const salt = ethers.hexlify(ethers.randomBytes(16));
  const entitlementIds = Array.from({ length: count }, (_, index) =>
    ethers.keccak256(ethers.toUtf8Bytes(`nomine:entitlement:${salt}:${index}`)),
  );
  const tree = buildMerkleTree(entitlementIds);

  const budget = BigInt(count) * allocation;
  await fx.usdc.mint(await issuer.getAddress(), options.mintAmount ?? budget);
  await fx.usdc
    .connect(issuer)
    .approve(fx.coreAddress, options.approveAmount ?? budget);

  const tx = await fx.core.connect(issuer).createCampaign({
    issuerApprover: options.issuerApprover ?? fx.issuerApprover.address,
    resolver: options.resolver ?? fx.resolver.address,
    recoveryDestination: options.recoveryDestination ?? fx.recovery.address,
    allocation,
    entitlementCount: count,
    openingTime,
    expiryTime,
    entitlementRoot: tree.root,
  });
  const receipt = await tx.wait();

  let campaignId = 0n;
  for (const log of receipt!.logs) {
    try {
      const parsed = fx.core.interface.parseLog(log);
      if (parsed?.name === "CampaignFunded") {
        campaignId = parsed.args.campaignId as bigint;
      }
    } catch {
      // not ours
    }
  }
  expect(campaignId).to.not.equal(0n, "CampaignFunded was not emitted");

  return { campaignId, entitlementIds, tree, openingTime, expiryTime };
}

interface SignedSettlement {
  request: {
    campaignId: bigint;
    entitlementId: string;
    wallet: string;
    amount: bigint;
    deadline: bigint;
  };
  claimantSignature: string;
  approval: {
    campaignId: bigint;
    entitlementId: string;
    wallet: string;
    amount: bigint;
    deadline: bigint;
    consentDigest: string;
  };
  issuerSignature: string;
  resolverSignature: string;
  proof: string[];
}

async function signSettlement(
  fx: Fixture,
  handle: CampaignHandle,
  entitlementId: string,
  walletSigner: HardhatEthersSigner,
  options: {
    amount?: bigint;
    deadline?: bigint;
    walletOverride?: string;
    consentDomainOverrides?: { chainId?: number; verifyingContract?: string };
  } = {},
): Promise<SignedSettlement> {
  const wallet = options.walletOverride ?? (await walletSigner.getAddress());
  const amount = options.amount ?? ALLOCATION;
  const deadline = options.deadline ?? handle.expiryTime;

  const request = {
    campaignId: handle.campaignId,
    entitlementId,
    wallet,
    amount,
    deadline,
  };

  // The approvals always carry the digest the contract expects. The claimant may be
  // made to sign under a different domain to prove the contract rejects it.
  const attestationDomain = campaignDomain(fx);
  const consent = consentDigest(attestationDomain, request);
  const claimantSigningDomain = options.consentDomainOverrides
    ? domain(fx.chainId, fx.coreAddress, options.consentDomainOverrides)
    : attestationDomain;
  const claimantSignature = await walletSigner.signTypedData(claimantSigningDomain, CLAIM_REQUEST_TYPES, request);

  const approval = { ...request, consentDigest: consent };
  const issuerSignature = await fx.issuerApprover.signTypedData(attestationDomain, APPROVAL_TYPES, approval);
  const resolverSignature = await fx.resolver.signTypedData(attestationDomain, APPROVAL_TYPES, approval);

  let proof: string[] = [];
  try {
    proof = handle.tree.proof(entitlementId);
  } catch {
    // A fabricated identifier has no proof; the contract must reject it on membership.
    proof = [];
  }

  return {
    request,
    claimantSignature,
    approval,
    issuerSignature,
    resolverSignature,
    proof,
  };
}

async function submitSettlement(
  fx: Fixture,
  signed: SignedSettlement,
  signer: HardhatEthersSigner = fx.relayer,
) {
  return fx.core
    .connect(signer)
    .settle(
      signed.request,
      signed.claimantSignature,
      signed.approval,
      signed.issuerSignature,
      signed.resolverSignature,
      signed.proof,
    );
}

describe("NomineClaimCore", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await deployFixture();
  });

  describe("campaign funding", () => {
    it("fixes the whole configuration and escrows the full budget", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 3 });
      const campaign = await fx.core.getCampaign(handle.campaignId);

      expect(campaign.issuer).to.equal(fx.issuer.address);
      expect(campaign.issuerApprover).to.equal(fx.issuerApprover.address);
      expect(campaign.resolver).to.equal(fx.resolver.address);
      expect(campaign.recoveryDestination).to.equal(fx.recovery.address);
      expect(campaign.allocation).to.equal(ALLOCATION);
      expect(campaign.entitlementCount).to.equal(3n);
      expect(campaign.settlementCount).to.equal(0n);
      expect(campaign.entitlementRoot).to.equal(handle.tree.root);
      expect(campaign.openingTime).to.equal(handle.openingTime);
      expect(campaign.expiryTime).to.equal(handle.expiryTime);
      expect(campaign.reclaimed).to.equal(false);

      expect(await fx.usdc.balanceOf(fx.coreAddress)).to.equal(3n * ALLOCATION);
      expect(await fx.core.budgetOf(handle.campaignId)).to.equal(3n * ALLOCATION);
      expect(await fx.core.reclaimableOf(handle.campaignId)).to.equal(3n * ALLOCATION);
    });

    it("refuses a configuration that collapses both approving authorities into one", async () => {
      await expect(
        fundCampaign(fx, { issuerApprover: fx.resolver.address, resolver: fx.resolver.address }),
      ).to.be.revertedWithCustomError(fx.core, "AuthoritiesNotDistinct");
    });

    it("refuses a recovery destination that would strand or burn the funds", async () => {
      await expect(
        fundCampaign(fx, { recoveryDestination: fx.coreAddress }),
      ).to.be.revertedWithCustomError(fx.core, "InvalidRecoveryDestination");
      await expect(
        fundCampaign(fx, { recoveryDestination: await fx.usdc.getAddress() }),
      ).to.be.revertedWithCustomError(fx.core, "InvalidRecoveryDestination");
    });

    it("refuses a zero allocation, zero count, or empty commitment", async () => {
      const tree = buildMerkleTree([
        ethers.keccak256(ethers.toUtf8Bytes("entitlement-a")),
        ethers.keccak256(ethers.toUtf8Bytes("entitlement-b")),
      ]);
      const now = await latestTimestamp();
      const base = {
        issuerApprover: fx.issuerApprover.address,
        resolver: fx.resolver.address,
        recoveryDestination: fx.recovery.address,
        allocation: ALLOCATION,
        entitlementCount: 2,
        openingTime: now,
        expiryTime: now + DAY,
        entitlementRoot: tree.root,
      };

      await expect(fx.core.connect(fx.issuer).createCampaign({ ...base, allocation: 0n })).to.be.revertedWithCustomError(
        fx.core,
        "ZeroValue",
      );
      await expect(
        fx.core.connect(fx.issuer).createCampaign({ ...base, entitlementCount: 0 }),
      ).to.be.revertedWithCustomError(fx.core, "ZeroValue");
      await expect(
        fx.core.connect(fx.issuer).createCampaign({ ...base, entitlementRoot: ethers.ZeroHash }),
      ).to.be.revertedWithCustomError(fx.core, "ZeroValue");
    });

    it("refuses a window that is closed or already in the past", async () => {
      const now = await latestTimestamp();
      await expect(fundCampaign(fx, { openingTime: now + DAY, expiryTime: now + DAY })).to.be.revertedWithCustomError(
        fx.core,
        "InvalidWindow",
      );
      await expect(fundCampaign(fx, { expiryTime: now - 1n })).to.be.revertedWithCustomError(
        fx.core,
        "InvalidWindow",
      );
    });

    it("fails closed when the budget is not fully transferable", async () => {
      await expect(fundCampaign(fx, { entitlementCount: 2, mintAmount: ALLOCATION })).to.be.reverted;
      await expect(fundCampaign(fx, { entitlementCount: 2, approveAmount: 0n })).to.be.reverted;
    });
  });

  describe("happy path settlement", () => {
    it("settles once, pays the exact allocation to the signed wallet, and emits canonical evidence", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 4 });
      const entitlementId = handle.entitlementIds[0];
      const signed = await signSettlement(fx, handle, entitlementId, fx.claimant);

      const claimantBefore = await fx.usdc.balanceOf(fx.claimant.address);
      const tx = await submitSettlement(fx, signed);
      const receipt = await tx.wait();

      const settlementLog = receipt!.logs
        .map((log: any) => {
          try {
            return fx.core.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed: any) => parsed?.name === "Settlement");

      expect(settlementLog, "Settlement event").to.not.equal(undefined);
      expect(settlementLog!.args.campaignId).to.equal(handle.campaignId);
      expect(settlementLog!.args.entitlementId).to.equal(entitlementId);
      expect(settlementLog!.args.wallet).to.equal(fx.claimant.address);
      expect(settlementLog!.args.amount).to.equal(ALLOCATION);
      expect(settlementLog!.args.submitter).to.equal(fx.relayer.address);

      expect(await fx.usdc.balanceOf(fx.claimant.address)).to.equal(claimantBefore + ALLOCATION);
      expect(await fx.core.isEntitlementConsumed(handle.campaignId, entitlementId)).to.equal(true);
      expect(await fx.core.settledAmountOf(handle.campaignId)).to.equal(ALLOCATION);

      const campaign = await fx.core.getCampaign(handle.campaignId);
      expect(campaign.settlementCount).to.equal(1n);
      expect(await fx.usdc.balanceOf(fx.coreAddress)).to.equal(3n * ALLOCATION);
    });

    it("is permissionless: any submitter produces the same approved result", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 2 });
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);

      await expect(submitSettlement(fx, signed, fx.attacker)).to.changeTokenBalance(
        fx.usdc,
        fx.claimant,
        ALLOCATION,
      );
      expect(await fx.core.isEntitlementConsumed(handle.campaignId, signed.request.entitlementId)).to.equal(true);
    });

    it("accepts a proof for a non-first entitlement", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 5 });
      const signed = await signSettlement(fx, handle, handle.entitlementIds[4], fx.claimant);
      await expect(submitSettlement(fx, signed)).to.not.be.reverted;
    });
  });

  describe("dual attestation", () => {
    it("fails when either authority acts alone", async () => {
      const handle = await fundCampaign(fx);
      const entitlementId = handle.entitlementIds[0];
      const signed = await signSettlement(fx, handle, entitlementId, fx.claimant);

      await expect(
        submitSettlement(fx, { ...signed, resolverSignature: signed.issuerSignature }),
      ).to.be.revertedWithCustomError(fx.core, "InvalidResolverApproval");

      await expect(
        submitSettlement(fx, { ...signed, issuerSignature: signed.resolverSignature }),
      ).to.be.revertedWithCustomError(fx.core, "InvalidIssuerApproval");

      await expect(submitSettlement(fx, { ...signed, resolverSignature: "0x" })).to.be.reverted;
    });

    it("fails when one authority plus attacker-controlled wallet consent is offered", async () => {
      const handle = await fundCampaign(fx);
      // The attacker controls both the wallet and its consent, and the entitlement is
      // genuinely listed. A single valid authority is still not enough.
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.attacker);
      await expect(
        submitSettlement(fx, { ...signed, resolverSignature: signed.issuerSignature }),
      ).to.be.revertedWithCustomError(fx.core, "InvalidResolverApproval");
      expect(await fx.core.isEntitlementConsumed(handle.campaignId, handle.entitlementIds[0])).to.equal(false);
    });

    it("rejects approvals signed under another chain ID or verifying contract", async () => {
      const handle = await fundCampaign(fx);
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);

      const wrongChain = domain(fx.chainId + 1, fx.coreAddress);
      const issuerSignature = await fx.issuerApprover.signTypedData(wrongChain, APPROVAL_TYPES, signed.approval);
      await expect(submitSettlement(fx, { ...signed, issuerSignature })).to.be.revertedWithCustomError(
        fx.core,
        "InvalidIssuerApproval",
      );

      const wrongContract = domain(fx.chainId, fx.attacker.address);
      const resolverSignature = await fx.resolver.signTypedData(wrongContract, APPROVAL_TYPES, signed.approval);
      await expect(submitSettlement(fx, { ...signed, resolverSignature })).to.be.revertedWithCustomError(
        fx.core,
        "InvalidResolverApproval",
      );
    });

    it("binds both attestations to the claimant's signed request digest", async () => {
      const handle = await fundCampaign(fx);
      const entitlementId = handle.entitlementIds[0];
      const signed = await signSettlement(fx, handle, entitlementId, fx.claimant);

      // An approval signed over a different consent digest — a different request —
      // must not be usable for this one.
      const foreignRequest = { ...signed.request, wallet: fx.otherClaimant.address };
      const foreignConsent = consentDigest(campaignDomain(fx), foreignRequest);
      const mismatchedApproval = { ...signed.approval, consentDigest: foreignConsent };
      const attestationDomain = campaignDomain(fx);
      const issuerSignature = await fx.issuerApprover.signTypedData(
        attestationDomain,
        APPROVAL_TYPES,
        mismatchedApproval,
      );
      const resolverSignature = await fx.resolver.signTypedData(
        attestationDomain,
        APPROVAL_TYPES,
        mismatchedApproval,
      );

      await expect(
        fx.core
          .connect(fx.relayer)
          .settle(
            signed.request,
            signed.claimantSignature,
            mismatchedApproval,
            issuerSignature,
            resolverSignature,
            signed.proof,
          ),
      ).to.be.revertedWithCustomError(fx.core, "ApprovalMismatch");
    });
  });

  describe("claimant consent", () => {
    it("fails when wallet consent is missing or from another wallet", async () => {
      const handle = await fundCampaign(fx);
      const entitlementId = handle.entitlementIds[0];
      const signed = await signSettlement(fx, handle, entitlementId, fx.attacker, {
        walletOverride: fx.claimant.address,
      });

      await expect(submitSettlement(fx, signed)).to.be.revertedWithCustomError(fx.core, "InvalidClaimantConsent");
    });

    it("rejects a substituted payout wallet", async () => {
      const handle = await fundCampaign(fx);
      const entitlementId = handle.entitlementIds[0];
      const signed = await signSettlement(fx, handle, entitlementId, fx.claimant);

      await expect(
        submitSettlement(fx, { ...signed, approval: { ...signed.approval, wallet: fx.attacker.address } }),
      ).to.be.revertedWithCustomError(fx.core, "ApprovalMismatch");
    });
  });

  describe("domain binding and substitution", () => {
    it("rejects consent signed for another chain ID", async () => {
      const handle = await fundCampaign(fx);
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant, {
        consentDomainOverrides: { chainId: fx.chainId + 1 },
      });
      await expect(submitSettlement(fx, signed)).to.be.revertedWithCustomError(fx.core, "InvalidClaimantConsent");
    });

    it("rejects consent signed for another verifying contract", async () => {
      const handle = await fundCampaign(fx);
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant, {
        consentDomainOverrides: { verifyingContract: fx.attacker.address },
      });
      await expect(submitSettlement(fx, signed)).to.be.revertedWithCustomError(fx.core, "InvalidClaimantConsent");
    });

    it("rejects approvals for another campaign, entitlement, amount, or deadline", async () => {
      const handle = await fundCampaign(fx);
      const other = await fundCampaign(fx, { entitlementCount: 2 });
      const entitlementId = handle.entitlementIds[0];
      const signed = await signSettlement(fx, handle, entitlementId, fx.claimant);

      await expect(
        submitSettlement(fx, { ...signed, approval: { ...signed.approval, campaignId: other.campaignId } }),
      ).to.be.revertedWithCustomError(fx.core, "ApprovalMismatch");

      await expect(
        submitSettlement(fx, {
          ...signed,
          approval: { ...signed.approval, entitlementId: handle.entitlementIds[1] },
        }),
      ).to.be.revertedWithCustomError(fx.core, "ApprovalMismatch");

      await expect(
        submitSettlement(fx, { ...signed, approval: { ...signed.approval, amount: ALLOCATION + 1n } }),
      ).to.be.revertedWithCustomError(fx.core, "ApprovalMismatch");

      await expect(
        submitSettlement(fx, { ...signed, approval: { ...signed.approval, deadline: signed.approval.deadline - 1n } }),
      ).to.be.revertedWithCustomError(fx.core, "ApprovalMismatch");
    });

    it("rejects a request amount that is not the fixed allocation", async () => {
      const handle = await fundCampaign(fx);
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant, {
        amount: ALLOCATION - 1n,
      });
      await expect(submitSettlement(fx, signed)).to.be.revertedWithCustomError(fx.core, "AmountNotAllocation");
    });
  });

  describe("membership and consumption", () => {
    it("rejects a fabricated entitlement with a plausible-membership payload", async () => {
      const handle = await fundCampaign(fx);
      const fabricated = ethers.keccak256(ethers.toUtf8Bytes("not-in-the-tree"));
      const signed = await signSettlement(fx, handle, fabricated, fx.claimant);
      await expect(submitSettlement(fx, signed)).to.be.revertedWithCustomError(fx.core, "EntitlementNotListed");
    });

    it("rejects reuse of a consumed entitlement with fresh signatures or a new wallet", async () => {
      const handle = await fundCampaign(fx);
      const entitlementId = handle.entitlementIds[0];
      const first = await signSettlement(fx, handle, entitlementId, fx.claimant);
      await submitSettlement(fx, first);

      const replay = await signSettlement(fx, handle, entitlementId, fx.claimant);
      await expect(submitSettlement(fx, replay)).to.be.revertedWithCustomError(
        fx.core,
        "EntitlementAlreadyConsumed",
      );

      const toOtherWallet = await signSettlement(fx, handle, entitlementId, fx.otherClaimant);
      await expect(submitSettlement(fx, toOtherWallet)).to.be.revertedWithCustomError(
        fx.core,
        "EntitlementAlreadyConsumed",
      );
    });

    it("rejects double settlement of the same signed request", async () => {
      const handle = await fundCampaign(fx);
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);
      await submitSettlement(fx, signed);
      await expect(submitSettlement(fx, signed)).to.be.revertedWithCustomError(
        fx.core,
        "EntitlementAlreadyConsumed",
      );
    });

    it("keeps entitlements campaign-scoped", async () => {
      const first = await fundCampaign(fx, { entitlementCount: 2 });
      const second = await fundCampaign(fx, { entitlementCount: 2 });
      const sharedId = first.entitlementIds[0];

      const signed = await signSettlement(fx, first, sharedId, fx.claimant);
      await submitSettlement(fx, signed);

      expect(await fx.core.isEntitlementConsumed(first.campaignId, sharedId)).to.equal(true);
      expect(await fx.core.isEntitlementConsumed(second.campaignId, sharedId)).to.equal(false);
    });
  });

  describe("timing boundaries", () => {
    it("refuses settlement before opening", async () => {
      const now = await latestTimestamp();
      const handle = await fundCampaign(fx, { openingTime: now + DAY, expiryTime: now + 10n * DAY });
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);
      await expect(submitSettlement(fx, signed)).to.be.revertedWithCustomError(fx.core, "CampaignNotOpen");
    });

    it("refuses settlement exactly at and after expiry", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 2 });
      await increaseTime(handle.expiryTime - (await latestTimestamp()) + 1n);

      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant, {
        deadline: handle.expiryTime + 100n * DAY,
      });
      await expect(submitSettlement(fx, signed)).to.be.revertedWithCustomError(fx.core, "CampaignExpired");
    });

    it("applies expiry while an approval deadline outlives it", async () => {
      // A request whose deadline is far beyond expiry still cannot settle once the
      // campaign has expired: expiry is the campaign's own rule, not the approval window.
      const handle = await fundCampaign(fx, { entitlementCount: 2 });
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant, {
        deadline: handle.expiryTime + 365n * DAY,
      });

      await mineAt(handle.expiryTime);
      await expect(submitSettlement(fx, signed)).to.be.revertedWithCustomError(fx.core, "CampaignExpired");
    });

    it("enforces the approval deadline boundary exactly", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 3 });
      const now = await latestTimestamp();

      const expired = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant, {
        deadline: now - 1n,
      });
      await expect(submitSettlement(fx, expired)).to.be.revertedWithCustomError(fx.core, "ApprovalExpired");

      await mineAt(now + 60n);
      const stillValid = await signSettlement(fx, handle, handle.entitlementIds[1], fx.claimant, {
        deadline: now + 60n,
      });
      await expect(submitSettlement(fx, stillValid)).to.not.be.reverted;
    });
  });

  describe("capacity", () => {
    it("fully settles every listed entitlement and offers no further settlement", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 2 });
      for (const entitlementId of handle.entitlementIds) {
        const signed = await signSettlement(fx, handle, entitlementId, fx.claimant);
        await submitSettlement(fx, signed);
      }

      const campaign = await fx.core.getCampaign(handle.campaignId);
      expect(campaign.settlementCount).to.equal(2n);
      expect(await fx.core.remainingUnsettledOf(handle.campaignId)).to.equal(0n);
      expect(await fx.usdc.balanceOf(fx.coreAddress)).to.equal(0n);

      // Capacity is checked before consumption, so a sold-out campaign reports the
      // hard stop rather than the (also true) consumption of the entitlement.
      const again = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);
      await expect(submitSettlement(fx, again)).to.be.revertedWithCustomError(
        fx.core,
        "EntitlementCountReached",
      );
    });
  });

  describe("reclaim", () => {
    it("is issuer-only", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 2 });
      await increaseTime(handle.expiryTime - (await latestTimestamp()) + 1n);
      await expect(fx.core.connect(fx.attacker).reclaim(handle.campaignId)).to.be.revertedWithCustomError(
        fx.core,
        "NotIssuer",
      );
    });

    it("is refused before expiry even when all entitlements are settled", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 1 });
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);
      await submitSettlement(fx, signed);

      await expect(fx.core.connect(fx.issuer).reclaim(handle.campaignId)).to.be.revertedWithCustomError(
        fx.core,
        "NotExpired",
      );
    });

    it("returns only the unused balance to the fixed destination and leaves settled funds untouched", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 4 });
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);
      await submitSettlement(fx, signed);

      await increaseTime(handle.expiryTime - (await latestTimestamp()) + 1n);

      const expected = 3n * ALLOCATION;
      await expect(fx.core.connect(fx.issuer).reclaim(handle.campaignId)).to.changeTokenBalance(
        fx.usdc,
        fx.recovery,
        expected,
      );

      expect(await fx.usdc.balanceOf(fx.coreAddress)).to.equal(0n);
      expect(await fx.usdc.balanceOf(fx.claimant.address)).to.equal(ALLOCATION);
      expect(await fx.core.settledAmountOf(handle.campaignId)).to.equal(ALLOCATION);
      expect(await fx.core.budgetOf(handle.campaignId)).to.equal(4n * ALLOCATION);
    });

    it("cannot be duplicated and blocks later settlement", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 2 });
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);
      await increaseTime(handle.expiryTime - (await latestTimestamp()) + 1n);

      await fx.core.connect(fx.issuer).reclaim(handle.campaignId);
      await expect(fx.core.connect(fx.issuer).reclaim(handle.campaignId)).to.be.revertedWithCustomError(
        fx.core,
        "CampaignReclaimedAlready",
      );

      const late = await signSettlement(fx, handle, handle.entitlementIds[1], fx.claimant, {
        deadline: handle.expiryTime + 100n * DAY,
      });
      await expect(submitSettlement(fx, late)).to.be.revertedWithCustomError(
        fx.core,
        "CampaignReclaimedAlready",
      );
    });

    it("works without either approving authority participating", async () => {
      // Reclaim takes no signatures at all: losing an approving key must not strand funds.
      const handle = await fundCampaign(fx, { entitlementCount: 3 });
      await increaseTime(handle.expiryTime - (await latestTimestamp()) + 1n);
      await expect(fx.core.connect(fx.issuer).reclaim(handle.campaignId)).to.not.be.reverted;
    });
  });

  describe("immutability and accounting", () => {
    it("exposes no administrative surface at all", async () => {
      const stateChanging = fx.core.interface.fragments
        .filter((fragment: any) => fragment.type === "function")
        .filter((fragment: any) => fragment.stateMutability === "nonpayable" || fragment.stateMutability === "payable")
        .map((fragment: any) => fragment.name)
        .sort();

      expect(stateChanging).to.deep.equal(["createCampaign", "reclaim", "settle"]);

      const functionNames = fx.core.interface.fragments
        .filter((fragment: any) => fragment.type === "function")
        .map((fragment: any) => fragment.name);
      for (const forbidden of [
        "owner",
        "transferOwnership",
        "upgradeTo",
        "emergencyWithdrawUSDC",
        "sweep",
        "setResolver",
        "setIssuerApprover",
        "updateReceiver",
      ]) {
        expect(functionNames).to.not.include(forbidden);
      }
    });

    it("conserves funded = settled + remaining, then funded = settled + reclaimed", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 4 });
      const funded = await fx.core.budgetOf(handle.campaignId);

      const firstSigned = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);
      await submitSettlement(fx, firstSigned);
      const secondSigned = await signSettlement(fx, handle, handle.entitlementIds[1], fx.otherClaimant);
      await submitSettlement(fx, secondSigned);

      const settled = await fx.core.settledAmountOf(handle.campaignId);
      const remaining = await fx.core.remainingUnsettledOf(handle.campaignId);
      expect(settled).to.equal(2n * ALLOCATION);
      expect(remaining).to.equal(2n * ALLOCATION);
      expect(settled + remaining).to.equal(funded);
      expect(await fx.usdc.balanceOf(fx.coreAddress)).to.equal(remaining);

      await increaseTime(handle.expiryTime - (await latestTimestamp()) + 1n);
      await fx.core.connect(fx.issuer).reclaim(handle.campaignId);

      const reclaimedAmount = settled + remaining - settled;
      expect(settled + reclaimedAmount).to.equal(funded);
      expect(await fx.usdc.balanceOf(fx.coreAddress)).to.equal(0n);
      expect(await fx.core.reclaimableOf(handle.campaignId)).to.equal(0n);
    });
  });

  describe("event replay", () => {
    it("reconstructs funded, settled, remaining, reclaimed, and consumed entitlements", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 3 });
      const first = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);
      await submitSettlement(fx, first);
      await increaseTime(handle.expiryTime - (await latestTimestamp()) + 1n);
      await fx.core.connect(fx.issuer).reclaim(handle.campaignId);

      const events = await fx.core.queryFilter(fx.core.filters.CampaignFunded(), 0, "latest");
      const settlements = await fx.core.queryFilter(fx.core.filters.Settlement(), 0, "latest");
      const reclaims = await fx.core.queryFilter(fx.core.filters.CampaignReclaimed(), 0, "latest");

      const funded = events.reduce((sum: bigint, event: any) => sum + (event.args.fundedAmount as bigint), 0n);
      const settled = settlements.reduce((sum: bigint, event: any) => sum + (event.args.amount as bigint), 0n);
      const reclaimed = reclaims.reduce((sum: bigint, event: any) => sum + (event.args.amount as bigint), 0n);
      const consumed = new Set(settlements.map((event: any) => event.args.entitlementId as string));

      expect(funded).to.equal(3n * ALLOCATION);
      expect(settled).to.equal(ALLOCATION);
      expect(reclaimed).to.equal(2n * ALLOCATION);
      expect(funded).to.equal(settled + reclaimed + 0n);
      expect(consumed.size).to.equal(1);
      expect(consumed.has(handle.entitlementIds[0])).to.equal(true);

      const campaign = await fx.core.getCampaign(handle.campaignId);
      expect(BigInt(consumed.size)).to.equal(campaign.settlementCount);
    });

    it("emits no identity data and no expiry event", async () => {
      const handle = await fundCampaign(fx, { entitlementCount: 2 });
      const signed = await signSettlement(fx, handle, handle.entitlementIds[0], fx.claimant);
      await submitSettlement(fx, signed);
      await increaseTime(handle.expiryTime - (await latestTimestamp()) + 1n);
      await fx.core.connect(fx.issuer).reclaim(handle.campaignId);

      const eventNames = new Set<string>(
        fx.core.interface.fragments
          .filter((fragment: any) => fragment.type === "event")
          .map((fragment: any): string => fragment.name),
      );
      const ownEvents = ["CampaignFunded", "CampaignReclaimed", "Settlement"];
      for (const name of ownEvents) {
        expect(eventNames.has(name), `missing ${name}`).to.equal(true);
      }
      // The only other event is OpenZeppelin's empty domain declaration. Everything
      // this contract can emit is funding, settlement, or reclaim: no expiry event,
      // and no event carrying an identity.
      expect([...eventNames].filter((name) => !ownEvents.includes(name))).to.deep.equal([
        "EIP712DomainChanged",
      ]);
      expect([...eventNames].some((name) => /expir/i.test(name))).to.equal(false);

      const settlement = (await fx.core.queryFilter(fx.core.filters.Settlement(), 0, "latest"))[0];
      // The only entitlement fact on-chain is the opaque identifier.
      expect(settlement.args.entitlementId).to.equal(handle.entitlementIds[0]);
      expect(settlement.args.wallet).to.equal(fx.claimant.address);
    });
  });
});
