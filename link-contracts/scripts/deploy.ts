import hre from "hardhat";
import { ethers } from "ethers";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ARC_NETWORKS, isArcNetworkName, type ArcNetworkName } from "../config/arc";

/**
 * Arc deployment with a fail-closed preflight.
 *
 * Nothing is defaulted. The script refuses to continue unless:
 *   1. ARC_NETWORK names a known Arc network;
 *   2. that network's RPC environment variable is set;
 *   3. the endpoint's own `eth_chainId` matches the configured chain ID;
 *   4. the configured USDC address has code and reports the expected symbol and decimals;
 *   5. for a broadcast, ARC_DEPLOY_CONFIRM=1 (and, on mainnet, ARC_MAINNET_APPROVED=yes).
 *
 * Without step 5 it performs the preflight only and never broadcasts. A mismatch at
 * any earlier step stops the run with the expected and observed values.
 */

interface DeploymentRecord {
  contract: string;
  network: ArcNetworkName;
  chainId: number;
  usdc: string;
  address: string;
  deploymentTx: string;
  deployer: string;
  compiler: string;
  viaIR: boolean;
  optimizerRuns: number;
  recordedAt: string;
  explorer: string;
}

const ERC20_METADATA_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function readNetwork(): ArcNetworkName {
  const value = process.env.ARC_NETWORK ?? "";
  if (!isArcNetworkName(value)) {
    fail(
      `ARC_NETWORK must be "testnet" or "mainnet" (received ${JSON.stringify(value)}). ` +
        `Known Arc networks: ${Object.keys(ARC_NETWORKS).join(", ")}.`,
    );
  }
  return value;
}

async function main() {
  const networkName = readNetwork();
  const config = ARC_NETWORKS[networkName];

  const rpcUrl = process.env[config.rpcEnv] ?? "";
  if (rpcUrl.trim() === "") {
    fail(`Missing ${config.rpcEnv}. Set it to the Arc ${networkName} JSON-RPC endpoint before deploying.`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Ask the endpoint for its own chain ID. This must not be served from a cached or
  // configured value, or a mismatched endpoint would pass the preflight silently.
  const liveChainId = Number(BigInt(await provider.send("eth_chainId", [])));
  if (liveChainId !== config.chainId) {
    fail(
      `Chain ID mismatch: ${config.rpcEnv} reports ${liveChainId}, ` +
        `but Arc ${networkName} is configured as ${config.chainId}. Refusing to deploy.`,
    );
  }

  const usdcCode = await provider.getCode(config.usdc);
  if (usdcCode === "0x") {
    fail(`No contract code at the configured USDC address ${config.usdc} on Arc ${networkName}.`);
  }
  const usdc = new ethers.Contract(config.usdc, ERC20_METADATA_ABI, provider);
  const [symbol, decimals] = await Promise.all([
    usdc.symbol() as Promise<string>,
    usdc.decimals().then(Number) as Promise<number>,
  ]);
  if (decimals !== config.usdcDecimals) {
    fail(
      `USDC decimals mismatch at ${config.usdc}: expected ${config.usdcDecimals}, observed ${decimals}.`,
    );
  }
  if (symbol !== "USDC") {
    fail(`USDC symbol mismatch at ${config.usdc}: expected "USDC", observed "${symbol}".`);
  }

  const confirm = process.env.ARC_DEPLOY_CONFIRM === "1";
  const mainnetApproved = process.env.ARC_MAINNET_APPROVED === "yes";

  console.log("Nomine Claim Core deployment preflight");
  console.log(`  network            ${networkName}`);
  console.log(`  chain ID           ${liveChainId} (matches configured ${config.chainId})`);
  console.log(`  USDC               ${config.usdc} (${symbol}, ${decimals} decimals)`);
  console.log(`  explorer           ${config.explorer}`);

  if (!confirm) {
    console.log("\nPreflight only. Set ARC_DEPLOY_CONFIRM=1 to broadcast.");
    return;
  }
  if (networkName === "mainnet" && !mainnetApproved) {
    fail("Mainnet deployment requires ARC_MAINNET_APPROVED=yes (explicit founder approval).");
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";
  if (!privateKey) {
    fail("DEPLOYER_PRIVATE_KEY is required to broadcast.");
  }
  const wallet = new ethers.Wallet(privateKey, provider);
  const deployerBalance = await provider.getBalance(wallet.address);
  if (deployerBalance === 0n) {
    fail(`Deployer ${wallet.address} has no native balance to pay for gas on Arc ${networkName}.`);
  }

  const artifact = await hre.artifacts.readArtifact("NomineClaimCore");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log(`\nDeploying from ${wallet.address} ...`);
  const contract = await factory.deploy(config.usdc);
  const deploymentTx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  const record: DeploymentRecord = {
    contract: "NomineClaimCore",
    network: networkName,
    chainId: config.chainId,
    usdc: config.usdc,
    address,
    deploymentTx: deploymentTx!.hash,
    deployer: wallet.address,
    compiler: "0.8.24",
    viaIR: true,
    optimizerRuns: 200,
    recordedAt: new Date().toISOString(),
    explorer: `${config.explorer}/address/${address}`,
  };

  const outDir = join(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `arc-${networkName}.json`);
  writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`\n✔ Deployed NomineClaimCore at ${address}`);
  console.log(`  tx        ${record.deploymentTx}`);
  console.log(`  explorer  ${record.explorer}`);
  console.log(`  record    ${outFile}`);
  console.log(`\nVerify with:`);
  console.log(`  ARC_NETWORK=${networkName} npx hardhat verify --network arc${networkName === "testnet" ? "Testnet" : "Mainnet"} ${address} ${config.usdc}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
