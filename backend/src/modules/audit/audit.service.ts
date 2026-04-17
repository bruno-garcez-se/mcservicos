import { pool } from "../../db/pool";

type AuditInput = {
  actorUserId: number | null;
  action: string;
  targetType: string;
  targetId: number | null;
  details?: Record<string, unknown>;
};

export async function createAuditLog(input: AuditInput): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.details ? JSON.stringify(input.details) : null,
    ],
  );
}
