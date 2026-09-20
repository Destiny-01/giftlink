import { TypedDataDomain, TypedDataField } from "ethers";

export const CLAIM_PERMIT_DOMAIN = (
  chainId: number,
  contract: string,
  name: string,
  version: string
): TypedDataDomain => ({
  name,
  version,
  chainId,
  verifyingContract: contract,
});

export const CLAIM_PERMIT_TYPES: Record<string, TypedDataField[]> = {
  ClaimPermit: [
    { name: "dropId", type: "uint256" },
    { name: "claimer", type: "address" },
    { name: "expiry", type: "uint64" },
  ],
};
