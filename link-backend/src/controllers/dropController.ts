import { Response } from "express";
import {
  prepareDrop,
  confirmDrop,
  getDropDetails,
  issueClaimPermit,
  recordDropClaim,
  relayClaim,
  updateDropReceiver,
  recordDropRevocation,
  getSentDrops,
  getReceivedDrops,
  getClaimableDrops,
  getStatsOverview,
} from "../services/dropService";
import {
  ClaimConfirmRequest,
  ClaimPermitRequest,
  ConfirmDropRequest,
  PrepareDropRequest,
  RelayClaimRequest,
  RevokeDropRequest,
  UpdateReceiverRequest,
  UserDropsQuery,
} from "../dto/drop.dto";
import { AuthRequest } from "../middleware/auth";
import { ForbiddenError } from "../utils/errors";

export async function prepareDropHandler(req: AuthRequest, res: Response) {
  const body = req.body as PrepareDropRequest;
  const authUser = req.authUser;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  const response = await prepareDrop(body, authUser.privyUserId);
  res.json(response);
}

export async function confirmDropHandler(req: AuthRequest, res: Response) {
  const body = req.body as ConfirmDropRequest;
  const authUser = req.authUser;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  const result = await confirmDrop(body, authUser);
  res.json({ success: true, onchainId: result.onchainId });
}

export async function getDropDetailsHandler(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const authUser = req.authUser;
  const drop = await getDropDetails(id, authUser);
  res.json(drop);
}

export async function issueClaimPermitHandler(req: AuthRequest, res: Response) {
  const body = req.body as ClaimPermitRequest;
  const authUser = req.authUser;
  const { id } = req.params;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  // Wallet binding and the recipient policy live in one shared place, so this endpoint
  // cannot drift from the relay endpoint's checks. `body.claimerIdentifier` is accepted
  // for caller compatibility and deliberately unused: the identity that authorizes a
  // claim is the provider-verified one.
  const permit = await issueClaimPermit(id, body, authUser, "privy");
  res.json(permit);
}

export async function relayClaimHandler(req: AuthRequest, res: Response) {
  const body = req.body as RelayClaimRequest;
  const { id } = req.params;
  const authUser = req.authUser;

  // No blanket authentication requirement here: whether an account is needed depends on the
  // gift. `assertClaimAuthorized` requires one for identity-targeted gifts and accepts the
  // proven wallet-control signature for wallet-targeted and public ones.
  const response = await relayClaim(id, body, authUser);
  res.json(response);
}

export async function recordDropClaimHandler(req: AuthRequest, res: Response) {
  const body = req.body as ClaimConfirmRequest;
  const { id } = req.params;
  const authUser = req.authUser;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  await recordDropClaim(id, body, authUser);
  res.json({ success: true });
}

export async function updateReceiverHandler(req: AuthRequest, res: Response) {
  const body = req.body as UpdateReceiverRequest;
  const { id } = req.params;
  const authUser = req.authUser;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  const result = await updateDropReceiver(id, body, authUser.privyUserId);
  res.json(result);
}

export async function revokeDropHandler(req: AuthRequest, res: Response) {
  const body = req.body as RevokeDropRequest;
  const { id } = req.params;
  const authUser = req.authUser;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  await recordDropRevocation(id, body, authUser.privyUserId);
  res.json({ success: true });
}

export async function getSentDropsHandler(req: AuthRequest, res: Response) {
  const authUser = req.authUser;
  const { status, limit, offset } = req.query as Partial<UserDropsQuery>;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  // Use privyId to query drops - works with any wallet address
  const result = await getSentDrops(
    authUser.privyUserId,
    status,
    limit ? Number(limit) : 50,
    offset ? Number(offset) : 0
  );

  res.json(result);
}

export async function getReceivedDropsHandler(req: AuthRequest, res: Response) {
  const authUser = req.authUser;
  const { limit, offset } = req.query as Partial<UserDropsQuery>;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  // Use privyId to query drops - works with any wallet address
  const result = await getReceivedDrops(
    authUser.privyUserId,
    limit ? Number(limit) : 50,
    offset ? Number(offset) : 0
  );

  res.json(result);
}

export async function getClaimableDropsHandler(
  req: AuthRequest,
  res: Response
) {
  const authUser = req.authUser;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  // Use privyId to query drops - works with any wallet address
  const drops = await getClaimableDrops(authUser.privyUserId);
  res.json({ drops });
}

export async function getAllUserDropsHandler(req: AuthRequest, res: Response) {
  const authUser = req.authUser;
  const { status, limit, offset } = req.query as Partial<UserDropsQuery>;

  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  // Use privyId to query drops - works with any wallet address
  const [sentDrops, receivedDrops, claimableDrops] = await Promise.all([
    getSentDrops(
      authUser.privyUserId,
      status,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0
    ),
    getReceivedDrops(
      authUser.privyUserId,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0
    ),
    getClaimableDrops(authUser.privyUserId),
  ]);

  res.json({
    sent: sentDrops,
    received: receivedDrops,
    claimable: { drops: claimableDrops },
  });
}

export async function getStatsOverviewHandler(
  _req: AuthRequest,
  res: Response
) {
  const stats = await getStatsOverview();
  res.json(stats);
}
