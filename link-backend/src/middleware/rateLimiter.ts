import rateLimit from "express-rate-limit";

export const claimPermitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many claim attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

export const dropMutationLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: "Too many requests, please slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});
