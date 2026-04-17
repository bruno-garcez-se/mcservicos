import { NextFunction, Request, Response } from "express";
import { AuthUser, UserRole } from "../types/auth";
import { verifyAccessToken } from "../utils/jwt";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    res.status(401).json({ message: "Nao autenticado." });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, groupIds: payload.groupIds };
    next();
  } catch {
    res.status(401).json({ message: "Token invalido ou expirado." });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Nao autenticado." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: "Sem permissao para esta acao." });
      return;
    }
    next();
  };
}
