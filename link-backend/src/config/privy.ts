import { PrivyClient } from "@privy-io/server-auth";
import { env } from "./env";

export const privyClient = new PrivyClient(
  env.PRIVY_APP_ID,
  env.PRIVY_APP_SECRET
);
