import bcrypt from "bcryptjs";
import { type CookieOptions, Router } from "express";
import { z } from "zod";
import { authRateLimit } from "../../middlewares/rateLimit";
import { requireAuth } from "../../middlewares/auth";
import { pool } from "../../db/pool";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt";
import { createAuditLog } from "../audit/audit.service";
import { ensureUserMenuVisibilityColumns } from "../users/userMenuVisibility";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

const authRouter = Router();
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function isLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin.trim());
}

function getRefreshCookieOptions(origin: string | undefined): CookieOptions {
  const localOrigin = isLocalhostOrigin(origin);
  return {
    httpOnly: true,
    sameSite: localOrigin ? "lax" : "none",
    secure: !localOrigin,
    maxAge: REFRESH_COOKIE_MAX_AGE,
  };
}

authRouter.post("/login", authRateLimit, async (req, res) => {
  await ensureUserMenuVisibilityColumns();
  const body = loginSchema.parse(req.body);

  const userResult = await pool.query(
    `SELECT id, name, email, password_hash, role, active, can_view_senhas, can_view_transacional, can_view_negocial
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [body.email.toLowerCase()],
  );

  const user = userResult.rows[0] as
    | {
        id: number;
        name: string;
        email: string;
        password_hash: string;
        role: "admin" | "employee";
        active: boolean;
        can_view_senhas: boolean;
        can_view_transacional: boolean;
        can_view_negocial: boolean;
      }
    | undefined;

  if (!user || !user.active) {
    res.status(401).json({ message: "Credenciais invalidas." });
    return;
  }

  const ok = await bcrypt.compare(body.password, user.password_hash);
  if (!ok) {
    res.status(401).json({ message: "Credenciais invalidas." });
    return;
  }

  const groupsResult = await pool.query(
    `SELECT group_id
     FROM user_groups
     WHERE user_id = $1`,
    [user.id],
  );
  const groupIds = groupsResult.rows.map((row) => Number(row.group_id));

  const payload = {
    sub: user.id,
    role: user.role,
    groupIds,
    menuVisibility: {
      senhas: Boolean(user.can_view_senhas),
      transacional: Boolean(user.can_view_transacional),
      negocial: Boolean(user.can_view_negocial),
    },
  } as const;

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const cookieOptions = getRefreshCookieOptions(req.headers.origin);
  res.cookie("refreshToken", refreshToken, cookieOptions);

  await createAuditLog({
    actorUserId: user.id,
    action: "auth.login",
    targetType: "user",
    targetId: user.id,
    details: { email: user.email },
  });

  res.json({
    accessToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      groupIds,
      menuVisibility: {
        senhas: Boolean(user.can_view_senhas),
        transacional: Boolean(user.can_view_transacional),
        negocial: Boolean(user.can_view_negocial),
      },
    },
  });
});

authRouter.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
  if (!refreshToken) {
    res.status(401).json({ message: "Sessao expirada." });
    return;
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    const accessToken = signAccessToken(payload);
    res.json({ accessToken });
  } catch {
    res.status(401).json({ message: "Refresh token invalido." });
  }
});

authRouter.post("/logout", async (req, res) => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
  if (refreshToken) {
    try {
      const payload = verifyRefreshToken(refreshToken);
      await createAuditLog({
        actorUserId: payload.sub,
        action: "auth.logout",
        targetType: "user",
        targetId: payload.sub,
      });
    } catch {
      // Ignora token invalido no logout.
    }
  }
  const cookieOptions = getRefreshCookieOptions(req.headers.origin);
  res.clearCookie("refreshToken", {
    httpOnly: cookieOptions.httpOnly,
    sameSite: cookieOptions.sameSite,
    secure: cookieOptions.secure,
  });
  res.status(204).send();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  await ensureUserMenuVisibilityColumns();
  const user = req.user!;
  const result = await pool.query(
    `SELECT id, name, email, role, active, can_view_senhas, can_view_transacional, can_view_negocial
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [user.id],
  );
  const me = result.rows[0] as
    | {
        id: number;
        name: string;
        email: string;
        role: "admin" | "employee";
        active: boolean;
        can_view_senhas: boolean;
        can_view_transacional: boolean;
        can_view_negocial: boolean;
      }
    | undefined;

  if (!me || !me.active) {
    res.status(401).json({ message: "Sessao invalida." });
    return;
  }

  const groupsResult = await pool.query(
    `SELECT group_id
     FROM user_groups
     WHERE user_id = $1`,
    [user.id],
  );
  const groupIds = groupsResult.rows.map((row) => Number(row.group_id));

  res.json({
    id: me.id,
    name: me.name,
    email: me.email,
    role: me.role,
    groupIds,
    menuVisibility: {
      senhas: Boolean(me.can_view_senhas),
      transacional: Boolean(me.can_view_transacional),
      negocial: Boolean(me.can_view_negocial),
    },
  });
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const user = req.user!;
  const body = changePasswordSchema.parse(req.body);

  const result = await pool.query(
    `SELECT id, password_hash
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [user.id],
  );
  const dbUser = result.rows[0] as { id: number; password_hash: string } | undefined;

  if (!dbUser) {
    res.status(404).json({ message: "Usuario nao encontrado." });
    return;
  }

  const isCurrentValid = await bcrypt.compare(body.currentPassword, dbUser.password_hash);
  if (!isCurrentValid) {
    res.status(400).json({ message: "Senha atual incorreta." });
    return;
  }

  const nextPasswordHash = await bcrypt.hash(body.newPassword, 10);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    nextPasswordHash,
    user.id,
  ]);

  await createAuditLog({
    actorUserId: user.id,
    action: "auth.change_password",
    targetType: "user",
    targetId: user.id,
  });

  res.status(204).send();
});

export { authRouter };
