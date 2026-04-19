import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { createAuditLog } from "../audit/audit.service";
import { emitCredentialDelete, emitCredentialUpsert } from "../../realtime/socket";
import { pool } from "../../db/pool";
import {
  createCredential,
  deleteCredential,
  listCredentialsForUser,
  updateCredential,
} from "./passwords.service";
import { ensureCredentialAccessModeColumn } from "./credentialAccessMode";

const payloadSchema = z.object({
  systemName: z.string().default(""),
  accessMode: z
    .enum(["web", "vpn", "online"])
    .default("web")
    .transform((value) => (value === "online" ? "web" : value)),
  linkUrl: z.string().default(""),
  username: z.string().default(""),
  password: z.string().default(""),
  groupIds: z.array(z.number().int().positive()).default([]),
  extraFields: z
    .array(
      z.object({
        name: z.string().default(""),
        value: z.string().default(""),
      }),
    )
    .default([]),
});

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const passwordsRouter = Router();

async function canEditCredential(user: NonNullable<Express.Request["user"]>, credentialId: number): Promise<boolean> {
  if (user.role === "admin") return true;
  if (!user.groupIds.length) return false;
  const accessResult = await pool.query(
    `SELECT 1
     FROM credential_groups
     WHERE credential_id = $1
       AND group_id = ANY($2::int[])
     LIMIT 1`,
    [credentialId, user.groupIds],
  );
  return (accessResult.rowCount ?? 0) > 0;
}

passwordsRouter.get("/", requireAuth, async (req, res) => {
  await ensureCredentialAccessModeColumn();
  const user = req.user!;
  const list = await listCredentialsForUser(user);
  res.json(list);
});

passwordsRouter.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  await ensureCredentialAccessModeColumn();
  const user = req.user!;
  const payload = payloadSchema.parse(req.body);

  const created = await createCredential({
    ...payload,
    actorUserId: user.id,
  });

  await createAuditLog({
    actorUserId: user.id,
    action: "credential.create",
    targetType: "credential",
    targetId: created.id,
    details: {
      systemName: created.systemName,
      linkUrl: created.linkUrl,
        accessMode: created.accessMode,
      groupIds: created.groupIds,
      extraFieldNames: created.extraFields.map((item) => item.name),
    },
  });

  emitCredentialUpsert(created.groupIds, created);
  res.status(201).json(created);
});

passwordsRouter.put(
  "/:id",
  requireAuth,
  async (req, res) => {
    await ensureCredentialAccessModeColumn();
    const user = req.user!;
    const params = paramsSchema.parse(req.params);
    const payload = payloadSchema.parse(req.body);
    const allowedToEdit = await canEditCredential(user, params.id);
    if (!allowedToEdit) {
      res.status(403).json({ message: "Sem permissao para editar esta credencial." });
      return;
    }
    const previousGroupsResult = await pool.query(
      `SELECT group_id FROM credential_groups WHERE credential_id = $1`,
      [params.id],
    );
    const previousGroupIds = previousGroupsResult.rows.map((row) => Number(row.group_id));

    const updated = await updateCredential({
      id: params.id,
      ...payload,
      actorUserId: user.id,
    });
    if (!updated) {
      res.status(404).json({ message: "Credencial nao encontrada." });
      return;
    }

    await createAuditLog({
      actorUserId: user.id,
      action: "credential.update",
      targetType: "credential",
      targetId: updated.id,
      details: {
        systemName: updated.systemName,
        linkUrl: updated.linkUrl,
        accessMode: updated.accessMode,
        groupIds: updated.groupIds,
        extraFieldNames: updated.extraFields.map((item) => item.name),
      },
    });

    const removedGroupIds = previousGroupIds.filter(
      (groupId) => !updated.groupIds.includes(groupId),
    );
    if (removedGroupIds.length > 0) {
      emitCredentialDelete(removedGroupIds, updated.id);
    }
    emitCredentialUpsert(updated.groupIds, updated);
    res.json(updated);
  },
);

passwordsRouter.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    await ensureCredentialAccessModeColumn();
    const user = req.user!;
    const params = paramsSchema.parse(req.params);

    const groupIds = await deleteCredential(params.id);
    if (!groupIds) {
      res.status(404).json({ message: "Credencial nao encontrada." });
      return;
    }

    await createAuditLog({
      actorUserId: user.id,
      action: "credential.delete",
      targetType: "credential",
      targetId: params.id,
    });

    emitCredentialDelete(groupIds, params.id);
    res.status(204).send();
  },
);

export { passwordsRouter };
