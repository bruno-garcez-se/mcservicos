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
    `CREATE TABLE IF NOT EXISTS transaction_terminals (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
  await pool.query(
    `INSERT INTO transaction_terminals (code, name)
     VALUES ('258', 'Terminal 258'), ('259', 'Terminal 259')
     ON CONFLICT (code) DO NOTHING`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS transaction_daily (
      id SERIAL PRIMARY KEY,
      terminal_id INT REFERENCES transaction_terminals(id),
      day_date DATE NOT NULL,
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
  await pool.query(
    `ALTER TABLE transaction_daily
     ADD COLUMN IF NOT EXISTS terminal_id INT REFERENCES transaction_terminals(id)`,
  );
  await pool.query(`ALTER TABLE transaction_daily DROP CONSTRAINT IF EXISTS transaction_daily_day_date_key`);
  await pool.query(
    `UPDATE transaction_daily
     SET terminal_id = (
       SELECT id
       FROM transaction_terminals
       ORDER BY id ASC
       LIMIT 1
     )
     WHERE terminal_id IS NULL`,
  );
  await pool.query(`ALTER TABLE transaction_daily ALTER COLUMN terminal_id SET NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transaction_daily_day_date ON transaction_daily(day_date)`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_daily_terminal_day
     ON transaction_daily(terminal_id, day_date)`,
  );
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

async function assertTerminalExists(terminalId: number): Promise<void> {
  const result = await pool.query(`SELECT id FROM transaction_terminals WHERE id = $1 AND active = true LIMIT 1`, [
    terminalId,
  ]);
  if (!result.rows[0]) {
    throw new Error("Terminal invalido.");
  }
}

transactionsRouter.get("/terminals", requireAuth, async (_req, res) => {
  await ensureTransactionStructures();
  const result = await pool.query<{ id: number; code: string; name: string; active: boolean }>(
    `SELECT id, code, name, active
     FROM transaction_terminals
     ORDER BY code ASC`,
  );
  res.json({ items: result.rows });
});

transactionsRouter.post("/terminals", requireAuth, async (req, res) => {
  await ensureTransactionStructures();
  const user = req.user!;
  const payload = z
    .object({
      code: z.string().trim().min(1).max(30),
      name: z.string().trim().max(120).optional(),
    })
    .parse(req.body);
  const code = payload.code.toUpperCase();
  const created = await pool.query<{ id: number; code: string; name: string; active: boolean }>(
    `INSERT INTO transaction_terminals (code, name, active, updated_at)
     VALUES ($1, $2, true, NOW())
     ON CONFLICT (code) DO NOTHING
     RETURNING id, code, name, active`,
    [code, payload.name?.trim() || `Terminal ${code}`],
  );
  if (!created.rows[0]) {
    res.status(409).json({ message: "Terminal ja cadastrado." });
    return;
  }
  await createAuditLog({
    actorUserId: user.id,
    action: "transaction.terminal.create",
    targetType: "transaction_terminal",
    targetId: Number(created.rows[0].id),
    details: { code },
  });
  res.status(201).json(created.rows[0]);
});

transactionsRouter.get("/month", requireAuth, async (req, res) => {
  await ensureTransactionStructures();
  const now = new Date();
  const query = z
    .object({
      year: z.coerce.number().int().min(2000).max(2100).default(now.getUTCFullYear()),
      month: z.coerce.number().int().min(1).max(12).default(now.getUTCMonth() + 1),
      terminalId: z.coerce.number().int().positive().optional(),
    })
    .parse(req.query);
  if (query.terminalId) {
    await assertTerminalExists(query.terminalId);
  }
  const range = toMonthRange(query.year, query.month);
  const terminalClause = query.terminalId ? "AND d.terminal_id = $3" : "";
  const baseParams = query.terminalId ? [range.start, range.end, query.terminalId] : [range.start, range.end];
  const [itemsResult, totalsResult, byTerminalResult, terminalsResult] = await Promise.all([
    pool.query<{
      id: number;
      terminal_id: number;
      terminal_code: string;
      day_date: string;
      auth_count: number;
      saque_count: number;
      pix_saque_count: number;
      recarga_value: string;
      updated_at: string;
    }>(
      `SELECT
        d.id,
        d.terminal_id,
        t.code AS terminal_code,
        d.day_date::text AS day_date,
        d.auth_count,
        d.saque_count,
        d.pix_saque_count,
        d.recarga_value::text AS recarga_value,
        d.updated_at
      FROM transaction_daily d
      JOIN transaction_terminals t ON t.id = d.terminal_id
      WHERE d.day_date >= $1::date AND d.day_date < $2::date
      ${terminalClause}
      ORDER BY d.day_date ASC, t.code ASC`,
      baseParams,
    ),
    pool.query<{
      auth_total: number;
      saque_total: number;
      pix_saque_total: number;
      recarga_total: string;
    }>(
      `SELECT
        COALESCE(SUM(d.auth_count), 0)::int AS auth_total,
        COALESCE(SUM(d.saque_count), 0)::int AS saque_total,
        COALESCE(SUM(d.pix_saque_count), 0)::int AS pix_saque_total,
        COALESCE(SUM(d.recarga_value), 0)::text AS recarga_total
      FROM transaction_daily d
      WHERE d.day_date >= $1::date AND d.day_date < $2::date
      ${terminalClause}`,
      baseParams,
    ),
    pool.query<{
      terminal_id: number;
      terminal_code: string;
      auth_total: number;
      saque_total: number;
      pix_saque_total: number;
      recarga_total: string;
    }>(
      `SELECT
        d.terminal_id,
        t.code AS terminal_code,
        COALESCE(SUM(d.auth_count), 0)::int AS auth_total,
        COALESCE(SUM(d.saque_count), 0)::int AS saque_total,
        COALESCE(SUM(d.pix_saque_count), 0)::int AS pix_saque_total,
        COALESCE(SUM(d.recarga_value), 0)::text AS recarga_total
      FROM transaction_daily d
      JOIN transaction_terminals t ON t.id = d.terminal_id
      WHERE d.day_date >= $1::date AND d.day_date < $2::date
      GROUP BY d.terminal_id, t.code
      ORDER BY t.code ASC`,
      [range.start, range.end],
    ),
    pool.query<{ id: number; code: string; name: string; active: boolean }>(
      `SELECT id, code, name, active
       FROM transaction_terminals
       WHERE active = true
       ORDER BY code ASC`,
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
    terminals: terminalsResult.rows,
    items: itemsResult.rows.map((row) => ({
      id: Number(row.id),
      terminalId: Number(row.terminal_id),
      terminalCode: row.terminal_code,
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
    byTerminal: byTerminalResult.rows.map((row) => ({
      terminalId: Number(row.terminal_id),
      terminalCode: row.terminal_code,
      authCount: Number(row.auth_total ?? 0),
      saqueCount: Number(row.saque_total ?? 0),
      pixSaqueCount: Number(row.pix_saque_total ?? 0),
      recargaValue: Number(row.recarga_total ?? 0),
    })),
  });
});

transactionsRouter.get("/months", requireAuth, async (req, res) => {
  await ensureTransactionStructures();
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(120).default(24),
      terminalId: z.coerce.number().int().positive().optional(),
    })
    .parse(req.query);
  if (query.terminalId) {
    await assertTerminalExists(query.terminalId);
  }
  const whereClause = query.terminalId ? "WHERE d.terminal_id = $2" : "";
  const params = query.terminalId ? [query.limit, query.terminalId] : [query.limit];
  const result = await pool.query<{
    month_ref: string;
    days_count: number;
    auth_total: number;
    saque_total: number;
    pix_saque_total: number;
    recarga_total: string;
  }>(
    `SELECT
      TO_CHAR(d.day_date, 'YYYY-MM') AS month_ref,
      COUNT(DISTINCT d.day_date)::int AS days_count,
      COALESCE(SUM(d.auth_count), 0)::int AS auth_total,
      COALESCE(SUM(d.saque_count), 0)::int AS saque_total,
      COALESCE(SUM(d.pix_saque_count), 0)::int AS pix_saque_total,
      COALESCE(SUM(d.recarga_value), 0)::text AS recarga_total
    FROM transaction_daily d
    ${whereClause}
    GROUP BY 1
    ORDER BY month_ref DESC
    LIMIT $1`,
    params,
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
  const payload = dailyEntrySchema
    .extend({
      terminalId: z.coerce.number().int().positive(),
    })
    .parse(req.body);
  await assertTerminalExists(payload.terminalId);
  const result = await pool.query<{
    id: number;
    terminal_id: number;
    day_date: string;
    auth_count: number;
    saque_count: number;
    pix_saque_count: number;
    recarga_value: string;
    updated_at: string;
  }>(
    `INSERT INTO transaction_daily (
      terminal_id, day_date, auth_count, saque_count, pix_saque_count, recarga_value, created_by, updated_by, updated_at
    )
    VALUES ($1, $2::date, $3, $4, $5, $6, $7, $7, NOW())
    ON CONFLICT (terminal_id, day_date)
    DO UPDATE SET
      auth_count = EXCLUDED.auth_count,
      saque_count = EXCLUDED.saque_count,
      pix_saque_count = EXCLUDED.pix_saque_count,
      recarga_value = EXCLUDED.recarga_value,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING
      id,
      terminal_id,
      day_date::text AS day_date,
      auth_count,
      saque_count,
      pix_saque_count,
      recarga_value::text AS recarga_value,
      updated_at`,
    [
      payload.terminalId,
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
      terminalId: payload.terminalId,
      date: payload.date,
      authCount: payload.authCount,
      saqueCount: payload.saqueCount,
      pixSaqueCount: payload.pixSaqueCount,
      recargaValue: payload.recargaValue,
    },
  });
  res.status(201).json({
    id: Number(item.id),
    terminalId: Number(item.terminal_id),
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
  const deleted = await pool.query<{ id: number; day_date: string; terminal_id: number }>(
    `DELETE FROM transaction_daily
     WHERE id = $1
     RETURNING id, day_date::text AS day_date, terminal_id`,
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
      terminalId: Number(deleted.rows[0].terminal_id),
    },
  });
  res.status(204).send();
});

transactionsRouter.post("/import", requireAuth, async (req, res) => {
  await ensureTransactionStructures();
  const user = req.user!;
  const payload = z
    .object({
      terminalId: z.coerce.number().int().positive(),
      entries: z.array(dailyEntrySchema).min(1).max(2000),
    })
    .parse(req.body);
  await assertTerminalExists(payload.terminalId);
  await pool.query("BEGIN");
  try {
    for (const entry of payload.entries) {
      await pool.query(
        `INSERT INTO transaction_daily (
          terminal_id, day_date, auth_count, saque_count, pix_saque_count, recarga_value, created_by, updated_by, updated_at
        )
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $7, NOW())
        ON CONFLICT (terminal_id, day_date)
        DO UPDATE SET
          auth_count = EXCLUDED.auth_count,
          saque_count = EXCLUDED.saque_count,
          pix_saque_count = EXCLUDED.pix_saque_count,
          recarga_value = EXCLUDED.recarga_value,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()`,
        [
          payload.terminalId,
          entry.date,
          entry.authCount,
          entry.saqueCount,
          entry.pixSaqueCount,
          entry.recargaValue,
          user.id,
        ],
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
      terminalId: payload.terminalId,
      totalEntries: payload.entries.length,
    },
  });
  res.status(201).json({ importedRows: payload.entries.length });
});

export { transactionsRouter };
