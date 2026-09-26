import { keccak256, concat, getBytes, hexlify } from "ethers";

/**
 * Merkle tree matching `NomineClaimCore` exactly.
 *
 * Leaves are the hash of an entitlement identifier — never the identifier itself —
 * so the root and internal nodes cannot be presented as listed entitlements.
 * Internal nodes hash the sorted pair of their children (OpenZeppelin's
 * commutative hashing) and the last node of an odd level is promoted unchanged,
 * which is what the contract's funding-time commitment builds.
 */

function normalize(value: string): string {
  const bytes = getBytes(value);
  if (bytes.length !== 32) {
    throw new Error("entitlement identifier must be 32 bytes");
  }
  return hexlify(bytes).toLowerCase();
}

function hashPair(a: string, b: string): string {
  return a <= b ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export interface MerkleTree {
  root: string;
  /** Identifiers in the ascending order the contract requires at funding. */
  identifiers: string[];
  /** Non-leaf nodes, so tests can prove nodes and the root are not identifiers. */
  internalNodes: string[];
  proof(identifier: string): string[];
}

export function buildMerkleTree(identifiers: string[]): MerkleTree {
  if (identifiers.length === 0) {
    throw new Error("Merkle tree needs at least one identifier");
  }

  const sorted = identifiers.map(normalize).sort();
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1]) {
      throw new Error("duplicate entitlement identifier");
    }
  }

  const levels: string[][] = [sorted.map((identifier) => keccak256(identifier))];

  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 === current.length ? current[i] : hashPair(current[i], current[i + 1]));
    }
    levels.push(next);
  }

  const root = levels[levels.length - 1][0];
  const indexOf = new Map(sorted.map((identifier, index) => [identifier, index]));

  return {
    root,
    identifiers: sorted,
    internalNodes: levels.slice(1).flat(),
    proof(identifier: string): string[] {
      const target = normalize(identifier);
      const start = indexOf.get(target);
      if (start === undefined) throw new Error("identifier not in tree");

      let index = start;
      const proof: string[] = [];
      for (let level = 0; level < levels.length - 1; level += 1) {
        const nodes = levels[level];
        const sibling = index ^ 1;
        if (sibling < nodes.length) proof.push(nodes[sibling]);
        index = Math.floor(index / 2);
      }
      return proof;
    },
  };
}
