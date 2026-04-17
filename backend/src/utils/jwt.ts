import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { JwtPayload } from "../types/auth";

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: "7d" });
}

export function verifyAccessToken(token: string): JwtPayload {
  const parsed = jwt.verify(token, env.JWT_ACCESS_SECRET);
  return normalizePayload(parsed);
}

export function verifyRefreshToken(token: string): JwtPayload {
  const parsed = jwt.verify(token, env.JWT_REFRESH_SECRET);
  return normalizePayload(parsed);
}

function normalizePayload(raw: string | jwt.JwtPayload): JwtPayload {
  if (typeof raw === "string") {
    throw new Error("Payload JWT invalido.");
  }

  const sub = Number(raw.sub);
  const role = raw.role;
  const groupIds = raw.groupIds;

  if (
    !Number.isInteger(sub) ||
    (role !== "admin" && role !== "employee") ||
    !Array.isArray(groupIds)
  ) {
    throw new Error("Claims obrigatorias ausentes no token.");
  }

  return { sub, role, groupIds: groupIds.map((id) => Number(id)) };
}
