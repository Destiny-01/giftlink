import { Response } from "express";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { isIssuerAllowlisted, studioInviteOnly } from "../services/studioAccess";
import type { AuthRequest } from "../middleware/auth";

/**
 * Deployment-facing endpoints: the public network configuration a client reads to configure
 * itself, the hosting health probe, and the Studio access check.
 *
 * These expose only public identifiers (network, chain id, contract addresses) and
 * configuration that is already public in the build; nothing here is caller-specific except
 * the access check, which answers only for the authenticated caller.
 */

/** `GET /api/config` - the public network/limits view a frontend builds itself from. */
export async function getConfigHandler(_req: AuthRequest, res: Response) {
  const limits =
    env.MAX_CAMPAIGN_BUDGET_USDC !== undefined ||
    env.MAX_CAMPAIGN_RECIPIENTS !== undefined
      ? {
          maxBudgetUsdc: env.MAX_CAMPAIGN_BUDGET_USDC ?? null,
          maxRecipients: env.MAX_CAMPAIGN_RECIPIENTS ?? null,
        }
      : null;

  res.json({
    network: env.ARC_NETWORK,
    chainId: env.CHAIN_ID,
    claimCoreAddress: env.CLAIM_CORE_CONTRACT_ADDRESS.toLowerCase(),
    usdcAddress: env.USDC_CONTRACT_ADDRESS.toLowerCase(),
    studioInviteOnly: studioInviteOnly(),
    limits,
  });
}

/** `GET /api/health` - a shallow, non-crashing liveness/readiness probe. */
export async function getHealthHandler(_req: AuthRequest, res: Response) {
  const checkpoint = await prisma.chainCheckpoint.findUnique({
    where: {
      chainId_contractAddress: {
        chainId: env.CHAIN_ID,
        contractAddress: env.CLAIM_CORE_CONTRACT_ADDRESS.toLowerCase(),
      },
    },
    select: { lastScannedBlock: true },
  });

  res.json({
    ok: true,
    network: env.ARC_NETWORK,
    chainId: env.CHAIN_ID,
    claimCore: env.CLAIM_CORE_CONTRACT_ADDRESS.toLowerCase(),
    indexer: {
      lastScannedBlock: checkpoint?.lastScannedBlock?.toString() ?? null,
    },
  });
}

/** `GET /api/studio/access` - whether the authenticated caller may use Studio. */
export async function getStudioAccessHandler(req: AuthRequest, res: Response) {
  const privyUserId = req.authUser?.privyUserId;
  res.json({ allowed: privyUserId ? isIssuerAllowlisted(privyUserId) : false });
}
