import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { pool } from "../../db/pool";
import { createAuditLog } from "../audit/audit.service";
import {
  DEFAULT_NEGOCIAL_SECTIONS_VISIBILITY,
  ensureUserMenuVisibilityColumns,
  normalizeMenuVisibility,
} from "./userMenuVisibility";

const usersRouter = Router();
const menuVisibilitySchema = z
  .object({
    senhas: z.boolean(),
    transacional: z.boolean(),
    negocial: z.boolean(),
    contatos: z.boolean(),
    negocialSections: z
      .object({
        cadastro: z.boolean(),
        funil: z.boolean(),
        agenda: z.boolean(),
        importacoes: z.boolean(),
        comissao: z.boolean(),
        relatorios: z.boolean(),
      })
      .default(DEFAULT_NEGOCIAL_SECTIONS_VISIBILITY),
  })
  .default({
    senhas: true,
    transacional: true,
    negocial: true,
    contatos: true,
    negocialSections: DEFAULT_NEGOCIAL_SECTIONS_VISIBILITY,
  });

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["admin", "employee", "observer"]).default("employee"),
  active: z.boolean().default(true),
  groupIds: z.array(z.number().int().positive()).default([]),
  menuVisibility: menuVisibilitySchema,
});

const updateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "employee", "observer"]),
  active: z.boolean(),
  groupIds: z.array(z.number().int().positive()).default([]),
  password: z.string().min(6).optional(),
  menuVisibility: menuVisibilitySchema,
});

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

usersRouter.use(requireAuth, requireRole("admin"));
usersRouter.use(async (_req, _res, next) => {
  try {
    await ensureUserMenuVisibilityColumns();
    await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await pool.query(
      `ALTER TABLE users
       ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'employee', 'observer'))`,
    );
    next();
  } catch (error) {
    next(error);
  }
});

usersRouter.get("/", async (_req, res) => {
  const usersResult = await pool.query(
    `SELECT id, name, email, role, active, can_view_senhas, can_view_transacional, can_view_negocial, can_view_contatos, can_view_negocial_sections, created_at
     FROM users
     ORDER BY name ASC`,
  );

  const users = [];
  for (const row of usersResult.rows) {
    const groups = await pool.query(
      `SELECT g.id, g.name
       FROM groups g
       INNER JOIN user_groups ug ON ug.group_id = g.id
       WHERE ug.user_id = $1
       ORDER BY g.name ASC`,
      [row.id],
    );

    users.push({
      id: Number(row.id),
      name: String(row.name),
      email: String(row.email),
      role: row.role as "admin" | "employee" | "observer",
      active: Boolean(row.active),
      menuVisibility: normalizeMenuVisibility({
        senhas: row.can_view_senhas,
        transacional: row.can_view_transacional,
        negocial: row.can_view_negocial,
        contatos: row.can_view_contatos,
        negocialSections: row.can_view_negocial_sections,
      }),
      createdAt: String(row.created_at),
      groups: groups.rows.map((group) => ({
        id: Number(group.id),
        name: String(group.name),
      })),
      groupIds: groups.rows.map((group) => Number(group.id)),
    });
  }

  res.json(users);
});

usersRouter.post("/", async (req, res) => {
  const actor = req.user!;
  const payload = createUserSchema.parse(req.body);

  const passwordHash = await bcrypt.hash(payload.password, 10);
  const createdResult = await pool.query(
    `INSERT INTO users (
      name,
      email,
      password_hash,
      role,
      active,
      can_view_senhas,
      can_view_transacional,
      can_view_negocial,
      can_view_contatos,
      can_view_negocial_sections
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING id, name, email, role, active, can_view_senhas, can_view_transacional, can_view_negocial, can_view_contatos, can_view_negocial_sections, created_at`,
    [
      payload.name,
      payload.email.toLowerCase(),
      passwordHash,
      payload.role,
      payload.active,
      payload.menuVisibility.senhas,
      payload.menuVisibility.transacional,
      payload.menuVisibility.negocial,
      payload.menuVisibility.contatos,
      JSON.stringify(payload.menuVisibility.negocialSections),
    ],
  );

  const created = createdResult.rows[0] as {
    id: number;
    name: string;
    email: string;
    role: "admin" | "employee" | "observer";
    active: boolean;
    can_view_senhas: boolean;
    can_view_transacional: boolean;
    can_view_negocial: boolean;
    can_view_contatos: boolean;
    can_view_negocial_sections: unknown;
    created_at: string;
  };

  if (payload.groupIds.length > 0) {
    await pool.query(
      `INSERT INTO user_groups (user_id, group_id)
       SELECT $1, UNNEST($2::int[])`,
      [created.id, payload.groupIds],
    );
  }

  await createAuditLog({
    actorUserId: actor.id,
    action: "user.create",
    targetType: "user",
    targetId: created.id,
    details: {
      email: created.email,
      role: created.role,
      groupIds: payload.groupIds,
    },
  });

  res.status(201).json({
    id: created.id,
    name: created.name,
    email: created.email,
    role: created.role,
    active: created.active,
    menuVisibility: normalizeMenuVisibility({
      senhas: created.can_view_senhas,
      transacional: created.can_view_transacional,
      negocial: created.can_view_negocial,
      contatos: created.can_view_contatos,
      negocialSections: created.can_view_negocial_sections,
    }),
    createdAt: created.created_at,
    groupIds: payload.groupIds,
  });
});

usersRouter.put("/:id", async (req, res) => {
  const actor = req.user!;
  const params = paramsSchema.parse(req.params);
  const payload = updateUserSchema.parse(req.body);

  const fields: string[] = [
    "name = $1",
    "email = $2",
    "role = $3",
    "active = $4",
    "can_view_senhas = $5",
    "can_view_transacional = $6",
    "can_view_negocial = $7",
    "can_view_contatos = $8",
    "can_view_negocial_sections = $9::jsonb",
  ];
  const values: unknown[] = [
    payload.name,
    payload.email.toLowerCase(),
    payload.role,
    payload.active,
    payload.menuVisibility.senhas,
    payload.menuVisibility.transacional,
    payload.menuVisibility.negocial,
    payload.menuVisibility.contatos,
    JSON.stringify(payload.menuVisibility.negocialSections),
  ];

  if (payload.password) {
    const hash = await bcrypt.hash(payload.password, 10);
    values.push(hash);
    fields.push(`password_hash = $${values.length}`);
  }

  values.push(params.id);
  const whereIndex = values.length;

  const updatedResult = await pool.query(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $${whereIndex}
     RETURNING id, name, email, role, active, can_view_senhas, can_view_transacional, can_view_negocial, can_view_contatos, can_view_negocial_sections, created_at`,
    values,
  );

  if (updatedResult.rowCount === 0) {
    res.status(404).json({ message: "Usuario nao encontrado." });
    return;
  }

  await pool.query(`DELETE FROM user_groups WHERE user_id = $1`, [params.id]);
  if (payload.groupIds.length > 0) {
    await pool.query(
      `INSERT INTO user_groups (user_id, group_id)
       SELECT $1, UNNEST($2::int[])`,
      [params.id, payload.groupIds],
    );
  }

  await createAuditLog({
    actorUserId: actor.id,
    action: "user.update",
    targetType: "user",
    targetId: params.id,
    details: {
      email: payload.email,
      role: payload.role,
      active: payload.active,
      groupIds: payload.groupIds,
      passwordChanged: Boolean(payload.password),
    },
  });

  const updated = updatedResult.rows[0] as {
    id: number;
    name: string;
    email: string;
    role: "admin" | "employee" | "observer";
    active: boolean;
    can_view_senhas: boolean;
    can_view_transacional: boolean;
    can_view_negocial: boolean;
    can_view_contatos: boolean;
    can_view_negocial_sections: unknown;
    created_at: string;
  };

  res.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    active: updated.active,
    menuVisibility: normalizeMenuVisibility({
      senhas: updated.can_view_senhas,
      transacional: updated.can_view_transacional,
      negocial: updated.can_view_negocial,
      contatos: updated.can_view_contatos,
      negocialSections: updated.can_view_negocial_sections,
    }),
    createdAt: updated.created_at,
    groupIds: payload.groupIds,
  });
});

usersRouter.delete("/:id", async (req, res) => {
  const actor = req.user!;
  const params = paramsSchema.parse(req.params);

  if (actor.id === params.id) {
    res.status(400).json({ message: "Nao e permitido excluir o proprio usuario." });
    return;
  }

  // Remove referencias opcionais para evitar bloqueio por chave estrangeira.
  await pool.query(`UPDATE credentials SET updated_by = NULL WHERE updated_by = $1`, [
    params.id,
  ]);
  await pool.query(`UPDATE audit_logs SET actor_user_id = NULL WHERE actor_user_id = $1`, [
    params.id,
  ]);

  const deletedResult = await pool.query(
    `DELETE FROM users
     WHERE id = $1
     RETURNING id, email, role`,
    [params.id],
  );

  if (deletedResult.rowCount === 0) {
    res.status(404).json({ message: "Usuario nao encontrado." });
    return;
  }

  const deleted = deletedResult.rows[0] as {
    id: number;
    email: string;
    role: "admin" | "employee" | "observer";
  };

  await createAuditLog({
    actorUserId: actor.id,
    action: "user.delete",
    targetType: "user",
    targetId: deleted.id,
    details: {
      email: deleted.email,
      role: deleted.role,
    },
  });

  res.status(204).send();
});

export { usersRouter };
