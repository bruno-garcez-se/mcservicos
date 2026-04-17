import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { pool } from "../../db/pool";
import { createAuditLog } from "../audit/audit.service";

const usersRouter = Router();

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["admin", "employee"]).default("employee"),
  active: z.boolean().default(true),
  groupIds: z.array(z.number().int().positive()).default([]),
});

const updateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "employee"]),
  active: z.boolean(),
  groupIds: z.array(z.number().int().positive()).default([]),
  password: z.string().min(6).optional(),
});

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

usersRouter.use(requireAuth, requireRole("admin"));

usersRouter.get("/", async (_req, res) => {
  const usersResult = await pool.query(
    `SELECT id, name, email, role, active, created_at
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
      role: row.role as "admin" | "employee",
      active: Boolean(row.active),
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
    `INSERT INTO users (name, email, password_hash, role, active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, role, active, created_at`,
    [
      payload.name,
      payload.email.toLowerCase(),
      passwordHash,
      payload.role,
      payload.active,
    ],
  );

  const created = createdResult.rows[0] as {
    id: number;
    name: string;
    email: string;
    role: "admin" | "employee";
    active: boolean;
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
  ];
  const values: unknown[] = [
    payload.name,
    payload.email.toLowerCase(),
    payload.role,
    payload.active,
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
     RETURNING id, name, email, role, active, created_at`,
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
    role: "admin" | "employee";
    active: boolean;
    created_at: string;
  };

  res.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    active: updated.active,
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
    role: "admin" | "employee";
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
