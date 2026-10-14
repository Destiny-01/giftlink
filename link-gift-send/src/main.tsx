// Polyfill Buffer for Privy (required for signMessage)
import { Buffer } from "buffer";
window.Buffer = Buffer;
globalThis.Buffer = Buffer;

import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import App from "./App.tsx";
import { configErrors, network, viemChain } from "./config/network";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

if (configErrors.length > 0) {
  // Fail closed: never mount Privy, wagmi or the app against a partial configuration.
  root.render(
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
        background: "#0B0B0D",
        color: "#F3F0E9",
        fontFamily: "Instrument Sans, system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>
        Configuration error
      </h1>
      <p style={{ color: "#B9B6B0", maxWidth: "32rem", textAlign: "center" }}>
        This deployment is missing required network configuration. Set the
        following environment variables and rebuild:
      </p>
      <ul style={{ fontFamily: "monospace", listStyle: "none", padding: 0 }}>
        {configErrors.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
} else {
  // Wagmi config for the configured Arc network.
  const wagmiConfig = createConfig({
    chains: [viemChain],
    transports: {
      [viemChain.id]: http(network.rpcUrl),
    },
  });

  const queryClient = new QueryClient();

  root.render(
    <PrivyProvider
      appId={network.privyAppId}
      config={{
        // The V1 Gate is verified email; X and Discord logins would produce accounts with
        // no email and an empty Inbox.
        loginMethods: ["email", "wallet"],
        // The Gate is verified email, so an email-only claimant must still end up with a wallet
        // to sign consent with. Creating the embedded wallet on login removes that dashboard
        // dependency.
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        appearance: {
          theme: "dark",
          accentColor: "#5546D9",
        },
        supportedChains: [viemChain],
        defaultChain: viemChain,
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </PrivyProvider>
  );
}
