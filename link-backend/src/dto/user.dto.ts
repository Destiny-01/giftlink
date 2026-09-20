import { z } from "zod";

export const privyAuthSchema = z.object({
  authToken: z.string().min(1, "Privy authentication token is required"),
});

export type PrivyAuthRequest = z.infer<typeof privyAuthSchema>;

export interface UserResponse {
  id: string;
  privyId: string;
  walletAddress: string | null;
  email: string | null;
  discordId: string | null;
  twitterId: string | null;
  telegramId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResponse {
  privyUserId: string;
  user: UserResponse;
}
