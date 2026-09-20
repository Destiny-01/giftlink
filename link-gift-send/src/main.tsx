// Polyfill Buffer for Privy (required for signMessage)
import { Buffer } from "buffer";
window.Buffer = Buffer;
globalThis.Buffer = Buffer;

import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import App from "./App.tsx";
import "./index.css";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || "";

// Define Arc Network chain (chain ID 1243)
const arc = defineChain({
  id: parseInt(import.meta.env.VITE_ARC_CHAIN_ID || "1243", 10),
  name: "Arc Network",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: [
        import.meta.env.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://testnet.arcscan.app",
    },
  },
});

// Wagmi config for Arc Network
const wagmiConfig = createConfig({
  chains: [arc],

  transports: {
    [arc.id]: http(
      import.meta.env.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network"
    ),
  },
});

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <PrivyProvider
    appId={PRIVY_APP_ID}
    config={{
      loginMethods: ["wallet", "email", "twitter", "discord"],
      appearance: {
        theme: "dark",
        accentColor: "#00FFD1",
      },
      supportedChains: [arc],
      defaultChain: arc,
    }}
  >
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </PrivyProvider>
);
