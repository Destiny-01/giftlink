import hre from "hardhat";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regenerates `abi/NomineClaimCore.json` from the compiled artefact so the ABI
 * consumed by other packages has one source of truth, generated from the same
 * bytecode that is deployed. The legacy backend ABI drifted from its contract by
 * being hand-written; generating it here removes that failure mode.
 */
async function main() {
  const artifact = await hre.artifacts.readArtifact("NomineClaimCore");
  const outDir = join(__dirname, "..", "abi");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "NomineClaimCore.json");
  writeFileSync(outFile, `${JSON.stringify(artifact.abi, null, 2)}\n`);

  const written = JSON.parse(readFileSync(outFile, "utf8"));
  if (written.length !== artifact.abi.length) {
    throw new Error("ABI export did not round-trip");
  }
  console.log(`Wrote ${written.length} ABI entries to ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
