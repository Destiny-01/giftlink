import { Request, Response } from "express";
import { authenticateWithPrivy } from "../services/authService";
import { PrivyAuthRequest, AuthResponse } from "../dto/user.dto";

export async function authenticate(
  req: Request<unknown, unknown, PrivyAuthRequest>,
  res: Response<AuthResponse>
) {
  const { authToken } = req.body;
  const result = await authenticateWithPrivy(authToken);
  res.json(result);
}
