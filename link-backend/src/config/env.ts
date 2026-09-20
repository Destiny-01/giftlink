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
  ENABLE_EVENT_LISTENER: z.coerce.boolean().default(true),
});

const envParseResult = envSchema.safeParse(process.env);

if (!envParseResult.success) {
  console.error("❌ Invalid environment variables:");
  console.error(envParseResult.error.format());
  process.exit(1);
}

export type Env = z.infer<typeof envSchema>;
export const env: Env = envParseResult.data;
