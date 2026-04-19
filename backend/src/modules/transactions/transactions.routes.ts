import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { requireAuth } from "../../middlewares/auth";
import { createAuditLog } from "../audit/audit.service";

const transactionsRouter = Router();
let transactionStructureEnsured = false;
const dailyEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  authCount: z.coerce.number().int().min(0),
  saqueCount: z.coerce.number().int().min(0),
  pixSaqueCount: z.coerce.number().int().min(0),
  recargaValue: z.coerce.number().min(0),
});

async function ensureTransactionStructures(): Promise<void> {
  if (transactionStructureEnsured) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS transaction_daily (
      id SERIAL PRIMARY KEY,
      day_date DATE NOT NULL UNIQUE,
      auth_count INT NOT NULL DEFAULT 0,
      saque_count INT NOT NULL DEFAULT 0,
      pix_saque_count INT NOT NULL DEFAULT 0,
      recarga_value NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_by INT REFERENCES users(id),
      updated_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transaction_daily_day_date ON transaction_daily(day_date)`);
  transactionStructureEnsured = true;
}

function toMonthRange(year: number, month: number): { start: string; end: string; monthRef: string } {
  const safeYear = Math.max(2000, Math.min(2100, year));
  const safeMonth = Math.max(1, Math.min(12, month));
  const start = new Date(Date.UTC(safeYear, safeMonth - 1, 1));
  const end = new Date(Date.UTC(safeYear, safeMonth, 1));
  const monthRef = `${safeYear}-${String(safeMonth).padStart(2, "0")}`;
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    monthRef,
  };
}

transactionsRouter.get("/month", requireAuth, async (req, res) => {
  await ensureTransactionStructures();
  const now = new Date();
  const query = z
    .object({
      year: z.coerce.number().int().min(2000).max(2100).default(now.getUTCFullYear()),
      month: z.coerce.number().int().min(1).max(12).default(now.getUTCMonth() + 1),
    })
    .parse(req.query);
  const range = toMonthRange(query.year, query.month);
  const [itemsResult, totalsResult] = await Promise.all([
    pool.query<{
      id: number;
      day_date: string;
      auth_count: number;
      saque_count: number;
      pix_saque_count: number;
      recarga_value: string;
      updated_at: string;
    }>(
      `SELECT
        id,
        day_date::text AS day_date,
        auth_count,
        saque_count,
        pix_saque_count,
        recarga_value::text AS recarga_value,
        updated_at
      FROM transaction_daily
      WHERE day_date >= $1::date AND day_date < $2::date
      ORDER BY day_date ASC`,
      [range.start, range.end],
    ),
    pool.query<{
      auth_total: number;
      saque_total: number;
      pix_saque_total: number;
      recarga_total: string;
    }>(
      `SELECT
        COALESCE(SUM(auth_count), 0)::int AS auth_total,
        COALESCE(SUM(saque_count), 0)::int AS saque_total,
        COALESCE(SUM(pix_saque_count), 0)::int AS pix_saque_total,
        COALESCE(SUM(recarga_value), 0)::text AS recarga_total
      FROM transaction_daily
      WHERE day_date >= $1::date AND day_date < $2::date`,
      [range.start, range.end],
    ),
  ]);
  const totals = totalsResult.rows[0] ?? {
    auth_total: 0,
    saque_total: 0,
    pix_saque_total: 0,
    recarga_total: "0",
  };
  res.json({
    monthRef: range.monthRef,
    items: itemsResult.rows.map((row) => ({
      id: row.id,
      date: row.day_date,
      authCount: Number(row.auth_count ?? 0),
      saqueCount: Number(row.saque_count ?? 0),
      pixSaqueCount: Number(row.pix_saque_count ?? 0),
      recargaValue: Number(row.recarga_value ?? 0),
      updatedAt: row.updated_at,
    })),
    totals: {
      authCount: Number(totals.auth_total ?? 0),
      saqueCount: Number(totals.saque_total ?? 0),
      pixSaqueCount: Number(totals.pix_saque_total ?? 0),
      recargaValue: Number(totals.recarga_total ?? 0),
    },
  });
});

transactionsRouter.get("/months", requireAuth, async (req, res) => {
  await ensureTransactionStructures();
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(120).default(24),
    })
    .parse(req.query);
  const result = await pool.query<{
    month_ref: string;
    days_count: number;
    auth_total: number;
    saque_total: number;
    pix_saque_total: number;
    recarga_total: string;
  }>(
    `SELECT
      TO_CHAR(day_date, 'YYYY-MM') AS month_ref,
      COUNT(*)::int AS days_count,
      COALESCE(SUM(auth_count), 0)::int AS auth_total,
      COALESCE(SUM(saque_count), 0)::int AS saque_total,
      COALESCE(SUM(pix_saque_count), 0)::int AS pix_saque_total,
      COALESCE(SUM(recarga_value), 0)::text AS recarga_total
    FROM transaction_daily
    GROUP BY 1
    ORDER BY month_ref DESC
    LIMIT $1`,
    [query.limit],
  );
  res.json({
    items: result.rows.map((row) => ({
      monthRef: row.month_ref,
      daysCount: Number(row.days_count ?? 0),
      authCount: Number(row.auth_total ?? 0),
      saqueCount: Number(row.saque_total ?? 0),
      pixSaqueCount: Number(row.pix_saque_total ?? 0),
      recargaValue: Number(row.recarga_total ?? 0),
    })),
  });
});

transactionsRouter.post("/daily", requireAuth, async (req, res) => {
  await ensureTransactionStructures();
  const user = req.user!;
  const payload = dailyEntrySchema.parse(req.body);
  const result = await pool.query<{
    id: number;
    day_date: string;
    auth_count: number;
    saque_count: number;
    pix_saque_count: number;
    recarga_value: string;
    updated_at: string;
  }>(
    `INSERT INTO transaction_daily (
      day_date, auth_count, saque_count, pix_saque_count, recarga_value, created_by, updated_by, updated_at
    )
    VALUES ($1::date, $2, $3, $4, $5, $6, $6, NOW())
    ON CONFLICT (day_date)
    DO UPDATE SET
      auth_count = EXCLUDED.auth_count,
      saque_count = EXCLUDED.saque_count,
      pix_saque_count = EXCLUDED.pix_saque_count,
      recarga_value = EXCLUDED.recarga_value,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING
      id,
      day_date::text AS day_date,
      auth_count,
      saque_count,
      pix_saque_count,
      recarga_value::text AS recarga_value,
      updated_at`,
    [
      payload.date,
      payload.authCount,
      payload.saqueCount,
      payload.pixSaqueCount,
      payload.recargaValue,
      user.id,
    ],
  );
  const item = result.rows[0];
  await createAuditLog({
    actorUserId: user.id,
    action: "transaction.daily.upsert",
    targetType: "transaction_daily",
    targetId: item ? Number(item.id) : null,
    details: {
      date: payload.date,
      authCount: payload.authCount,
      saqueCount: payload.saqueCount,
      pixSaqueCount: payload.pixSaqueCount,
      recargaValue: payload.recargaValue,
    },
  });
  res.status(201).json({
    id: Number(item.id),
    date: item.day_date,
    authCount: Number(item.auth_count ?? 0),
    saqueCount: Number(item.saque_count ?? 0),
    pixSaqueCount: Number(item.pix_saque_count ?? 0),
    recargaValue: Number(item.recarga_value ?? 0),
    updatedAt: item.updated_at,
  });
});

transactionsRouter.delete("/daily/:id", requireAuth, async (req, res) => {
  await ensureTransactionStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const deleted = await pool.query<{ id: number; day_date: string }>(
    `DELETE FROM transaction_daily
     WHERE id = $1
     RETURNING id, day_date::text AS day_date`,
    [params.id],
  );
  if (!deleted.rows[0]) {
    res.status(404).json({ message: "Lancamento nao encontrado." });
    return;
  }
  await createAuditLog({
    actorUserId: user.id,
    action: "transaction.daily.delete",
    targetType: "transaction_daily",
    targetId: params.id,
    details: {
      date: deleted.rows[0].day_date,
    },
  });
  res.status(204).send();
});

transactionsRouter.post("/import", requireAuth, async (req, res) => {
  await ensureTransactionStructures();
  const user = req.user!;
  const payload = z
    .object({
      entries: z.array(dailyEntrySchema).min(1).max(2000),
    })
    .parse(req.body);
  await pool.query("BEGIN");
  try {
    for (const entry of payload.entries) {
      await pool.query(
        `INSERT INTO transaction_daily (
          day_date, auth_count, saque_count, pix_saque_count, recarga_value, created_by, updated_by, updated_at
        )
        VALUES ($1::date, $2, $3, $4, $5, $6, $6, NOW())
        ON CONFLICT (day_date)
        DO UPDATE SET
          auth_count = EXCLUDED.auth_count,
          saque_count = EXCLUDED.saque_count,
          pix_saque_count = EXCLUDED.pix_saque_count,
          recarga_value = EXCLUDED.recarga_value,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()`,
        [entry.date, entry.authCount, entry.saqueCount, entry.pixSaqueCount, entry.recargaValue, user.id],
      );
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
  await createAuditLog({
    actorUserId: user.id,
    action: "transaction.import.upsert",
    targetType: "transaction_daily",
    targetId: null,
    details: {
      totalEntries: payload.entries.length,
    },
  });
  res.status(201).json({ importedRows: payload.entries.length });
});

export { transactionsRouter };
