import { keccak256, concat, getBytes, hexlify } from "ethers";

/**
 * Minimal OpenZeppelin-compatible Merkle tree: leaves are the raw 32-byte
 * entitlement identifiers, internal nodes hash the sorted pair of their children.
 * This matches `MerkleProof.verify` in the contract, so a proof produced here is
 * exactly what a coordination service would produce in production.
 */

function hashPair(a: string, b: string): string {
  return a.toLowerCase() <= b.toLowerCase()
    ? keccak256(concat([a, b]))
    : keccak256(concat([b, a]));
}

export interface MerkleTree {
  root: string;
  leaves: string[];
  proof(leaf: string): string[];
}

export function buildMerkleTree(leaves: string[]): MerkleTree {
  if (leaves.length === 0) {
    throw new Error("Merkle tree needs at least one leaf");
  }

  const normalized = leaves.map((leaf) => hexlify(getBytes(leaf)).toLowerCase());
  const levels: string[][] = [normalized];

  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 === current.length) {
        next.push(current[i]);
      } else {
        next.push(hashPair(current[i], current[i + 1]));
      }
    }
    levels.push(next);
  }

  const root = levels[levels.length - 1][0];

  return {
    root,
    leaves: normalized,
    proof(leaf: string): string[] {
      const target = hexlify(getBytes(leaf)).toLowerCase();
      let index = normalized.indexOf(target);
      if (index === -1) throw new Error("leaf not in tree");

      const proof: string[] = [];
      for (let level = 0; level < levels.length - 1; level += 1) {
        const nodes = levels[level];
        const siblingIndex = index ^ 1;
        if (siblingIndex < nodes.length) {
          proof.push(nodes[siblingIndex]);
        }
        index = Math.floor(index / 2);
      }
      return proof;
    },
  };
}
