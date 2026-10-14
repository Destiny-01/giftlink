import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
const hexStringRegex = /^0x[a-fA-F0-9]+$/;

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  RPC_URL: z.string().url(),
  GIFTLINK_CONTRACT_ADDRESS: z.string().regex(ethAddressRegex),
  /**
   * Nomine Claim Core (`docs/nomine-claim-core-integration.md` §1).
   *
   * Required, with **no default and no fallback**: a value that silently pointed at a
   * legacy contract or another chain would sign settlements against the wrong deployment,
   * which is the one failure the integration contract says the client must never allow
   * (§1: "Configuration is explicit and fails closed"). There is deliberately no
   * `CLAIM_CORE_CONTRACT_ADDRESS ?? GIFTLINK_CONTRACT_ADDRESS` anywhere in this service.
   */
  CLAIM_CORE_CONTRACT_ADDRESS: z.string().regex(ethAddressRegex),
  /**
   * The block the configured Claim Core deployment was deployed at.
   *
   * Required, like the contract address: scanning a public RPC from block `0` is rejected
   * outright by the network (it refuses an unbounded/oversized range), and guessing the
   * deployment block would silently skip or re-read history. It is the floor of every scan,
   * so a fresh checkpoint never starts below it.
   */
  CLAIM_CORE_DEPLOY_BLOCK: z.coerce.number().int().nonnegative(),
  /**
   * The largest block range one log query may span. The indexer starts each pass at this
   * width and halves it on a range/size rejection, so a network with a tighter cap than the
   * default still converges instead of failing the pass.
   */
  INDEXER_MAX_BLOCK_RANGE: z.coerce.number().int().positive().default(10000),
  USDC_CONTRACT_ADDRESS: z.string().regex(ethAddressRegex),
  CHAIN_ID: z.coerce.number(),
  BACKEND_SIGNER_PRIVATE_KEY: z.string().regex(hexStringRegex),
  BACKEND_SIGNER_ADDRESS: z.string().regex(ethAddressRegex),
  RELAYER_PRIVATE_KEY: z.string().regex(hexStringRegex),
  RELAYER_ADDRESS: z.string().regex(ethAddressRegex),
  SERVER_PEPPER: z.string().regex(hexStringRegex),
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  FRONTEND_URL: z.string().url(),
  EIP712_DOMAIN_NAME: z.string().default("GiftLinkPermit"),
  EIP712_VERSION: z.string().default("1"),
  /**
   * `z.coerce.boolean()` maps any non-empty string - including "false" and "0" - to true, which
   * would make this switch impossible to turn off. Parse the literal, as PRISMA_QUERY_LOG does.
   */
  ENABLE_EVENT_LISTENER: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /**
   * Prisma's query log includes bound parameters, so it prints raw emails, handles and
   * provider ids. Off unless asked for; see the logger note in config/prisma.ts.
   */
  PRISMA_QUERY_LOG: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

const envParseResult = envSchema.safeParse(process.env);

if (!envParseResult.success) {
  console.error("❌ Invalid environment variables:");
  console.error(envParseResult.error.format());
  process.exit(1);
}

export type Env = z.infer<typeof envSchema>;
export const env: Env = envParseResult.data;
