# Deployment records

`scripts/deploy.ts` writes one JSON record per network here after a successful
broadcast, e.g. `arc-testnet.json`:

```json
{
  "contract": "NomineClaimCore",
  "network": "testnet",
  "chainId": 5042002,
  "usdc": "0x3600000000000000000000000000000000000000",
  "address": "0x...",
  "deploymentTx": "0x...",
  "deployer": "0x...",
  "compiler": "0.8.24",
  "viaIR": true,
  "optimizerRuns": 200,
  "recordedAt": "2026-...",
  "explorer": "https://testnet.arcscan.app/address/0x..."
}
```

## Current status

No record exists yet. The Arc testnet deployment is **blocked**: this environment has
no `ARC_TESTNET_RPC_URL` and no funded `DEPLOYER_PRIVATE_KEY`. The deploy script's
fail-closed preflight is the reason nothing was broadcast — see
`link-contracts/README.md` ("Testnet deployment status").
