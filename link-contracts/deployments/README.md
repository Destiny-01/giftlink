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

Deployment and source verification are complete on Arc testnet. See [arc-testnet.json](arc-testnet.json), [runtime proof](arc-testnet-runtime.md), and [machine-readable evidence](arc-testnet-runtime.json). The runtime proof includes live funding, sponsored settlement, real expiry and issuer recovery. Approval authorities were simulated test actors; the independent human issuer-confirmation workflow remains outstanding.
