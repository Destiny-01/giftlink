import "./setup";
import test from "node:test";
import assert from "node:assert/strict";
import { TypedDataEncoder, Wallet, keccak256, toUtf8Bytes } from "ethers";
import {
  APPROVAL_TYPE_STRING,
  APPROVAL_TYPEHASH,
  APPROVAL_TYPES,
  CLAIM_REQUEST_TYPE_STRING,
  CLAIM_REQUEST_TYPEHASH,
  CLAIM_REQUEST_TYPES,
  assertEntitlementId,
  buildEntitlementProof,
  buildEntitlementTree,
  campaignBudget,
  claimCoreDomain,
  consentDigest,
  emailHashFor,
  emailHashFromNormalized,
  entitlementLeaf,
  entitlementRoot,
  generateEntitlementId,
  hashEntitlementPair,
  normalizeVerifiedEmail,
  recoverApprovalSigner,
  recoverClaimRequestSigner,
  sortEntitlementIds,
  verifyEntitlementProof,
} from "../src/utils/claimCore";
import { env } from "../src/config/env";

const CHAIN_ID = env.CHAIN_ID;
const CONTRACT = env.CLAIM_CORE_CONTRACT_ADDRESS;
const DOMAIN = claimCoreDomain(CHAIN_ID, CONTRACT);

const claimant = new Wallet(`0x${"11".repeat(32)}`);
const approver = new Wallet(`0x${"22".repeat(32)}`);

function identifiers(count: number): string[] {
  const ids: string[] = [];
  while (ids.length < count) {
    const candidate = generateEntitlementId();
    if (!ids.includes(candidate)) ids.push(candidate);
  }
  return ids;
}

function requestFor(entitlementId: string) {
  return {
    campaignId: 7n,
    entitlementId,
    wallet: claimant.address,
    amount: 100000n,
    deadline: 1790000000n,
  };
}

test("EIP-712 type strings and typehashes match the deployed contract byte for byte", () => {
  // These strings are the input to keccak256 on-chain (`CLAIM_REQUEST_TYPEHASH`,
  // `APPROVAL_TYPEHASH`). A whitespace or field-order change is not cosmetic: it changes the
  // digest and every honest signature stops recovering.
  assert.equal(
    CLAIM_REQUEST_TYPE_STRING,
    "ClaimRequest(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline)"
  );
  assert.equal(
    APPROVAL_TYPE_STRING,
    "Approval(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline,bytes32 consentDigest)"
  );
  assert.equal(CLAIM_REQUEST_TYPEHASH, keccak256(toUtf8Bytes(CLAIM_REQUEST_TYPE_STRING)));
  assert.equal(APPROVAL_TYPEHASH, keccak256(toUtf8Bytes(APPROVAL_TYPE_STRING)));
});

test("the EIP-712 domain matches EIP712(\"NomineClaimCore\", \"1\")", () => {
  assert.equal(DOMAIN.name, "NomineClaimCore");
  assert.equal(DOMAIN.version, "1");
  assert.equal(DOMAIN.chainId, CHAIN_ID);
  assert.equal(DOMAIN.verifyingContract, CONTRACT);
});

test("the consent digest agrees with an independent TypedDataEncoder computation", () => {
  const request = requestFor(identifiers(1)[0]);
  const expected = TypedDataEncoder.hash(DOMAIN, CLAIM_REQUEST_TYPES, request);
  assert.equal(consentDigest(request, CHAIN_ID, CONTRACT), expected);
});

test("claimant consent recovers the signer, and only for the exact request", async () => {
  const [id] = identifiers(1);
  const request = requestFor(id);
  const signature = await claimant.signTypedData(DOMAIN, CLAIM_REQUEST_TYPES, request);

  assert.equal(recoverClaimRequestSigner(request, signature), claimant.address.toLowerCase());

  // Any mutation of a bound field must stop the signature recovering to that wallet.
  assert.notEqual(
    recoverClaimRequestSigner({ ...request, amount: request.amount + 1n }, signature),
    claimant.address.toLowerCase()
  );
  assert.notEqual(
    recoverClaimRequestSigner({ ...request, deadline: request.deadline + 1n }, signature),
    claimant.address.toLowerCase()
  );
  assert.notEqual(
    recoverClaimRequestSigner({ ...request, campaignId: 8n }, signature),
    claimant.address.toLowerCase()
  );
  assert.notEqual(
    recoverClaimRequestSigner({ ...request, entitlementId: identifiers(1)[0] }, signature),
    claimant.address.toLowerCase()
  );

  // A signature by a different key never recovers to the wallet.
  const foreign = await approver.signTypedData(DOMAIN, CLAIM_REQUEST_TYPES, request);
  assert.notEqual(recoverClaimRequestSigner(request, foreign), claimant.address.toLowerCase());
});

test("consent signed for another chain does not recover", async () => {
  const [id] = identifiers(1);
  const request = requestFor(id);
  const signature = await claimant.signTypedData(
    claimCoreDomain(CHAIN_ID + 1, CONTRACT),
    CLAIM_REQUEST_TYPES,
    request
  );
  assert.notEqual(recoverClaimRequestSigner(request, signature), claimant.address.toLowerCase());
});

test("consent signed for another verifying contract does not recover", async () => {
  const [id] = identifiers(1);
  const request = requestFor(id);
  // A deployment that is neither the legacy GiftLink address nor the configured Claim Core.
  const signature = await claimant.signTypedData(
    claimCoreDomain(CHAIN_ID, `0x${"44".repeat(20)}`),
    CLAIM_REQUEST_TYPES,
    request
  );
  assert.notEqual(recoverClaimRequestSigner(request, signature), claimant.address.toLowerCase());
});

test("approval recovery requires the consent digest that was signed", async () => {
  const [id] = identifiers(1);
  const request = requestFor(id);
  const consent = consentDigest(request, CHAIN_ID, CONTRACT);
  const approval = { ...request, consentDigest: consent };
  const signature = await approver.signTypedData(DOMAIN, APPROVAL_TYPES, approval);

  assert.equal(recoverApprovalSigner(approval, signature), approver.address.toLowerCase());

  // Swapping the digest (a different claimant request) must not recover the authority.
  assert.notEqual(
    recoverApprovalSigner({ ...approval, consentDigest: `0x${"44".repeat(32)}` }, signature),
    approver.address.toLowerCase()
  );
});

test("a malformed signature yields null instead of throwing", () => {
  const request = requestFor(identifiers(1)[0]);
  assert.equal(recoverClaimRequestSigner(request, "0x"), null);
  assert.equal(recoverClaimRequestSigner(request, "not-a-signature"), null);
});

test("the commitment tree is order-independent and matches the leaf/pair rules", () => {
  const ids = identifiers(5);
  const tree = buildEntitlementTree(ids);

  assert.deepEqual(tree.ids, sortEntitlementIds(ids));
  assert.equal(tree.root, entitlementRoot([...ids].reverse()));

  // Leaves are hashed identifiers, never the identifier itself.
  assert.equal(tree.layers[0][0], entitlementLeaf(tree.ids[0]));
  assert.notEqual(tree.layers[0][0], tree.ids[0]);

  // Odd levels promote the last node unchanged, so a 5-leaf root is a hash of hashes.
  assert.equal(tree.layers[3].length, 1);
  assert.equal(entitlementLeaf(tree.ids[0]).length, 66);
});

test("every listed identifier proves; nothing else does", () => {
  const ids = identifiers(5);
  const root = entitlementRoot(ids);
  const [outsider] = identifiers(1);

  for (const id of ids) {
    assert.equal(verifyEntitlementProof(buildEntitlementProof(ids, id), root, id), true);
  }

  // A proof built for one identifier must not verify a different identifier.
  assert.equal(
    verifyEntitlementProof(buildEntitlementProof(ids, ids[0]), root, ids[1]),
    false
  );
  // Nor against another campaign's commitment.
  assert.equal(
    verifyEntitlementProof(buildEntitlementProof(ids, ids[0]), entitlementRoot([outsider]), ids[0]),
    false
  );
});

test("the root and internal nodes are not valid identifiers", () => {
  // The regression that matters: with hashed leaves, the root and internal nodes hash 32
  // bytes where internal nodes hash 64, so neither can be presented as a listed
  // entitlement even with a shortened proof.
  const ids = identifiers(4);
  const tree = buildEntitlementTree(ids);

  const internal = tree.layers[1][0];
  assert.notEqual(entitlementLeaf(tree.root), tree.root);
  assert.notEqual(entitlementLeaf(internal), internal);
  assert.equal(verifyEntitlementProof([], tree.root, tree.root), false);
  assert.equal(verifyEntitlementProof([], tree.root, internal), false);
  assert.equal(verifyEntitlementProof([internal], tree.root, tree.root), false);

  // A single-entitlement campaign is its own leaf, which is the one legitimate case.
  const single = identifiers(1);
  assert.equal(
    verifyEntitlementProof(buildEntitlementProof(single, single[0]), entitlementRoot(single), single[0]),
    true
  );
});

test("pair hashing is order-independent", () => {
  const [a, b] = identifiers(2);
  assert.equal(hashEntitlementPair(a, b), hashEntitlementPair(b, a));
});

test("entitlement identifiers are 32-byte hex and never repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 25; i += 1) {
    const id = generateEntitlementId();
    assert.match(id, /^0x[0-9a-fA-F]{64}$/);
    assert.equal(seen.has(id.toLowerCase()), false);
    seen.add(id.toLowerCase());
  }

  assert.throws(() => assertEntitlementId("0x1234"));
  assert.throws(() => assertEntitlementId("not-hex"));
  assert.doesNotThrow(() => assertEntitlementId(`0x${"11".repeat(32)}`));
});

test("email normalization is conservative and never merges aliases", () => {
  assert.equal(normalizeVerifiedEmail("  Alice@Example.COM "), "alice@example.com");
  // D-008 and §5: no Gmail-style dot or plus-alias merging.
  assert.notEqual(normalizeVerifiedEmail("a.b@example.com"), normalizeVerifiedEmail("ab@example.com"));
  assert.notEqual(normalizeVerifiedEmail("a+x@example.com"), normalizeVerifiedEmail("a@example.com"));
});

test("eligibility hashes are keyed, normalized and reveal nothing", () => {
  const hashed = emailHashFor("Alice@Example.com");
  assert.match(hashed, /^[0-9a-f]{64}$/);
  assert.equal(emailHashFor("  alice@example.com  "), hashed);
  assert.equal(hashed.includes("alice"), false);
  assert.equal(hashed.includes("example"), false);

  // Keyed: a different pepper produces a different index for the same address.
  assert.notEqual(emailHashFromNormalized("alice@example.com", `0x${"55".repeat(32)}`), hashed);
});

test("campaign budget is exact base-unit arithmetic", () => {
  assert.equal(campaignBudget("100000", 3), "300000");
  assert.equal(campaignBudget("1", 1), "1");
  assert.equal(campaignBudget("2500000", 12), "30000000");
});
