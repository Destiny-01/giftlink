/**
 * Testnet marker.
 *
 * Renders nothing on mainnet. Uses only approved identity tokens from
 * brand/approved/GUIDELINES.md: limestone #E5E1D8 background, onyx text, 3px radius, Instrument
 * Sans 550. No new colours are introduced.
 */

import { network } from "@/config/network";

interface TestnetPillProps {
  label?: string;
  className?: string;
}

export function TestnetPill({ label = "Testnet", className }: TestnetPillProps) {
  if (!network.isTestnet) return null;

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap bg-[#E5E1D8] px-1.5 py-0.5 text-[11px] leading-none text-[#0B0B0D] ${
        className ?? ""
      }`}
      style={{ borderRadius: 3, fontWeight: 550 }}
    >
      {label}
    </span>
  );
}
