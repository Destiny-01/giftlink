import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
const hexStringRegex = /^0x[a-fA-F0-9]+$/;
/** A decimal USDC amount with at most the six decimals the token supports. */
const decimalUsdcRegex = /^\d+(\.\d{1,6})?$/;

/**
 * The chain ids Arc exposes, keyed by the explicit network identity. Stating the network
 * and checking the chain id against it is what stops a deployment from signing for the
 * wrong chain: a testnet process pointed at mainnet (or the reverse) fails at startup.
 */
export const ARC_NETWORK_CHAIN_IDS = {
  testnet: 5042002,
  mainnet: 5042,
} as const;

/**
 * The synthetic chain id the test suite runs against. It is not an Arc network, so it is
 * accepted only while `NODE_ENV=test`, where every chain interaction is stubbed.
 */
export const TEST_CHAIN_ID = 31337;

/** An optional positive integer that treats an empty string as "unset" rather than 0. */
function optionalPositiveInt() {
  return z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().optional()
  );
}

/** An optional string that treats an empty string as "unset". */
function optionalString(schema: z.ZodString) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1),
    RPC_URL: z.string().url(),
    /**
     * The network this deployment talks to, stated explicitly rather than inferred from the
     * chain id. `CHAIN_ID` is checked against it below, so a misconfigured pair fails closed.
     */
    ARC_NETWORK: z.enum(["testnet", "mainnet"]),
    /**
     * Legacy GiftLink support is optional and off by default. The address is required only
     * when `ENABLE_LEGACY_GIFTLINK` is true; when legacy is on, it is the deployment every
     * legacy path talks to.
     */
    GIFTLINK_CONTRACT_ADDRESS: z.string().regex(ethAddressRegex).optional(),
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
    /**
     * Nomine's auto-approver key, the default `issuerApprover` for campaigns that opt into
     * automatic approval (D-021). Both variables are optional, but they come as a pair: a
     * private key without its address (or the reverse) is a half-configured deployment, so
     * the pair is required together and the derived address is checked in `config/wallets.ts`.
     */
    AUTO_APPROVER_PRIVATE_KEY: optionalString(z.string().regex(hexStringRegex)),
    AUTO_APPROVER_ADDRESS: optionalString(z.string().regex(ethAddressRegex)),
    SERVER_PEPPER: z.string().regex(hexStringRegex),
    PRIVY_APP_ID: z.string().min(1),
    PRIVY_APP_SECRET: z.string().min(1),
    FRONTEND_URL: z.string().url(),
    EIP712_DOMAIN_NAME: z.string().default("GiftLinkPermit"),
    EIP712_VERSION: z.string().default("1"),
    /**
     * The Privy user ids allowed into Studio, comma-separated. Trimmed and emptied of blank
     * entries. An empty list means Studio is open (the testnet default); a non-empty list
     * makes Studio invite-only, and is mandatory on mainnet.
     */
    ISSUER_ALLOWLIST: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      ),
    /**
     * Machine-enforced ceiling on a single campaign, in human USDC (compared in base units).
     * Optional and unlimited on testnet; mandatory on mainnet.
     */
    MAX_CAMPAIGN_BUDGET_USDC: optionalString(
      z.string().regex(decimalUsdcRegex, "Must be a decimal USDC amount")
    ),
    /** The most recipients one campaign may address. Optional on testnet, mandatory on mainnet. */
    MAX_CAMPAIGN_RECIPIENTS: optionalPositiveInt(),
    /**
     * The legacy GiftLink switch. `z.coerce.boolean()` maps any non-empty string - including
     * "false" and "0" - to true, so parse the literal, as ENABLE_EVENT_LISTENER and
     * PRISMA_QUERY_LOG do. Defaults off.
     */
    ENABLE_LEGACY_GIFTLINK: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
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
  })
  .superRefine((data, ctx) => {
    const expectedChainId = ARC_NETWORK_CHAIN_IDS[data.ARC_NETWORK];
    const isTestChain =
      data.NODE_ENV === "test" && data.CHAIN_ID === TEST_CHAIN_ID;
    if (!isTestChain && data.CHAIN_ID !== expectedChainId) {
      ctx.addIssue({
        path: ["CHAIN_ID"],
        code: z.ZodIssueCode.custom,
        message: "CHAIN_ID does not match ARC_NETWORK",
      });
    }

    // The auto-approver is optional, but a lone half of the pair is a misconfiguration: the
    // address would be unverifiable against a key that is not there (or vice versa).
    if (data.AUTO_APPROVER_PRIVATE_KEY && !data.AUTO_APPROVER_ADDRESS) {
      ctx.addIssue({
        path: ["AUTO_APPROVER_ADDRESS"],
        code: z.ZodIssueCode.custom,
        message: "AUTO_APPROVER_ADDRESS is required when AUTO_APPROVER_PRIVATE_KEY is set",
      });
    }
    if (data.AUTO_APPROVER_ADDRESS && !data.AUTO_APPROVER_PRIVATE_KEY) {
      ctx.addIssue({
        path: ["AUTO_APPROVER_PRIVATE_KEY"],
        code: z.ZodIssueCode.custom,
        message:
          "AUTO_APPROVER_PRIVATE_KEY is required when AUTO_APPROVER_ADDRESS is set",
      });
    }

    if (data.ARC_NETWORK === "mainnet") {
      if (data.ISSUER_ALLOWLIST.length === 0) {
        ctx.addIssue({
          path: ["ISSUER_ALLOWLIST"],
          code: z.ZodIssueCode.custom,
          message: "An issuer allowlist is required on mainnet",
        });
      }
      if (data.MAX_CAMPAIGN_BUDGET_USDC === undefined) {
        ctx.addIssue({
          path: ["MAX_CAMPAIGN_BUDGET_USDC"],
          code: z.ZodIssueCode.custom,
          message: "A campaign budget cap is required on mainnet",
        });
      }
      if (data.MAX_CAMPAIGN_RECIPIENTS === undefined) {
        ctx.addIssue({
          path: ["MAX_CAMPAIGN_RECIPIENTS"],
          code: z.ZodIssueCode.custom,
          message: "A campaign recipient cap is required on mainnet",
        });
      }
      if (data.ENABLE_LEGACY_GIFTLINK) {
        ctx.addIssue({
          path: ["ENABLE_LEGACY_GIFTLINK"],
          code: z.ZodIssueCode.custom,
          message: "Legacy GiftLink support must be disabled on mainnet",
        });
      }
    }

    if (data.ENABLE_LEGACY_GIFTLINK && !data.GIFTLINK_CONTRACT_ADDRESS) {
      ctx.addIssue({
        path: ["GIFTLINK_CONTRACT_ADDRESS"],
        code: z.ZodIssueCode.custom,
        message: "GIFTLINK_CONTRACT_ADDRESS is required when legacy support is enabled",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates a raw environment, returning the typed configuration or throwing an Error whose
 * message names the failing variables - and only their names.
 *
 * The message is deliberately value-free: the raw environment carries private keys, the
 * server pepper and provider secrets, and the message reaches the console, CI output and log
 * sinks. Zod's own issue messages are not surfaced for the same reason, since enum and regex
 * failures quote the received value.
 */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const names = [
      ...new Set(
        result.error.issues.map((issue) => issue.path.join(".") || "(unknown)")
      ),
    ];
    throw new Error(`Invalid environment variables: ${names.join(", ")}`);
  }

  return result.data;
}

/**
 * The process configuration. Parsing happens once at import; a failure exits the process so
 * a misconfigured deployment never starts serving.
 */
function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    console.error("❌ Invalid environment configuration");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export const env: Env = loadEnv();

/**
 * The legacy GiftLink contract address, or a throw when it is unset.
 *
 * The address is present whenever legacy support is enabled (validated above), so this is
 * non-optional exactly on the legacy paths. Legacy services call it rather than reading the
 * optional variable, keeping a non-optional `string` type, and a path reached without legacy
 * configured fails with a clear message instead of constructing a contract at `undefined`.
 */
export function legacyGiftLinkAddress(): string {
  if (!env.GIFTLINK_CONTRACT_ADDRESS) {
    throw new Error(
      "GIFTLINK_CONTRACT_ADDRESS is not configured; legacy GiftLink support is disabled"
    );
  }
  return env.GIFTLINK_CONTRACT_ADDRESS;
}
