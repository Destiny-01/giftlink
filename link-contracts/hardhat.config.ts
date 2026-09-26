import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import { ARC_NETWORKS } from "./config/arc";

/**
 * No RPC URL and no account is defaulted anywhere. `hardhat test` runs on the
 * in-process network; the Arc networks only work when the operator supplies the
 * endpoint and key named in `config/arc.ts`, so a missing value stops the task
 * instead of reaching a substituted chain.
 */
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // The settlement entry point carries both signatures, both approvals and a
      // membership proof; the IR pipeline keeps that reachable without splitting
      // verification across helpers whose storage reads are harder to follow.
      viaIR: true,
      // Cancun is not a free choice: OpenZeppelin 5 compiles `mcopy` (Cancun-only). The
      // target runtime must therefore expose Cancun opcodes — confirm against Arc's EVM
      // reference before the first broadcast, and downgrade OpenZeppelin to 4.x if it does
      // not.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    arcTestnet: {
      url: process.env[ARC_NETWORKS.testnet.rpcEnv] ?? "",
      chainId: ARC_NETWORKS.testnet.chainId,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    arcMainnet: {
      url: process.env[ARC_NETWORKS.mainnet.rpcEnv] ?? "",
      chainId: ARC_NETWORKS.mainnet.chainId,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      arcTestnet: process.env.ARC_EXPLORER_API_KEY ?? "",
      arcMainnet: process.env.ARC_EXPLORER_API_KEY ?? "",
    },
    customChains: [
      {
        network: "arcTestnet",
        chainId: ARC_NETWORKS.testnet.chainId,
        urls: {
          apiURL: `${ARC_NETWORKS.testnet.explorer}/api`,
          browserURL: ARC_NETWORKS.testnet.explorer,
        },
      },
      {
        network: "arcMainnet",
        chainId: ARC_NETWORKS.mainnet.chainId,
        urls: {
          apiURL: `${ARC_NETWORKS.mainnet.explorer}/api`,
          browserURL: ARC_NETWORKS.mainnet.explorer,
        },
      },
    ],
  },
  paths: {
    sources: "contracts",
    tests: "test",
    cache: "cache",
    artifacts: "artifacts",
  },
  mocha: {
    timeout: 120000,
  },
};

export default config;
