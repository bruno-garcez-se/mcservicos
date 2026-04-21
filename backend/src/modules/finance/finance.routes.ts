import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { requireAuth } from "../../middlewares/auth";
import { createAuditLog } from "../audit/audit.service";

const financeRouter = Router();
let financeStructureEnsured = false;

const entryTypeSchema = z.enum(["receita", "despesa"]);
const monthRefSchema = z.string().regex(/^\d{4}-\d{2}$/);
const optionalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const installmentFrequencySchema = z.enum(["mensal", "trimestral", "anual"]);
const deleteScopeSchema = z.enum(["single", "from_current"]);

const entryPayloadSchema = z.object({
  type: entryTypeSchema,
  description: z.string().trim().min(1).max(180),
  category: z.string().trim().max(120).default(""),
  amount: z.coerce.number().positive(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: optionalDateSchema,
  referenceMonth: monthRefSchema.optional(),
  paidAt: optionalDateSchema,
  paidAmount: z.coerce.number().positive().optional(),
  templateId: z.coerce.number().int().positive().optional(),
  notes: z.string().trim().max(1000).default(""),
  installmentsCount: z.coerce.number().int().min(1).max(120).optional(),
  installmentFrequency: installmentFrequencySchema.optional(),
});

const templatePayloadSchema = z.object({
  description: z.string().trim().min(1).max(180),
  category: z.string().trim().max(120).default(""),
  defaultAmount: z.coerce.number().min(0),
  dueDay: z.coerce.number().int().min(1).max(31),
  startMonth: monthRefSchema.optional(),
  isVariable: z.boolean().default(false),
  active: z.boolean().default(true),
  notes: z.string().trim().max(1000).default(""),
});

function monthRefToDate(monthRef: string): string {
  return `${monthRef}-01`;
}

function buildDueDate(year: number, month: number, dueDay: number): string {
  const endOfMonthDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(1, dueDay), endOfMonthDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function parseMonthRef(value: string): { year: number; month: number } {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function addMonthsToIsoDate(isoDate: string, monthsToAdd: number): string {
  const [yearRaw, monthRaw, dayRaw] = isoDate.split("-").map(Number);
  const safeYear = Number.isFinite(yearRaw) ? yearRaw : 1970;
  const safeMonth = Number.isFinite(monthRaw) ? monthRaw : 1;
  const safeDay = Number.isFinite(dayRaw) ? dayRaw : 1;
  const baseTotalMonths = safeYear * 12 + (safeMonth - 1) + monthsToAdd;
  const targetYear = Math.floor(baseTotalMonths / 12);
  const targetMonth = (baseTotalMonths % 12) + 1;
  const endOfMonthDay = new Date(targetYear, targetMonth, 0).getDate();
  const targetDay = Math.min(Math.max(1, safeDay), endOfMonthDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

function splitAmountByInstallments(totalAmount: number, installmentsCount: number): number[] {
  const safeCount = Math.max(1, Math.floor(installmentsCount));
  if (safeCount === 1) return [totalAmount];
  const totalInCents = Math.round(totalAmount * 100);
  const baseInCents = Math.floor(totalInCents / safeCount);
  let remainder = totalInCents % safeCount;
  const values: number[] = [];
  for (let index = 0; index < safeCount; index += 1) {
    const extra = remainder > 0 ? 1 : 0;
    values.push((baseInCents + extra) / 100);
    remainder = Math.max(0, remainder - 1);
  }
  return values;
}

async function upsertExpenseTemplatesForMonth(monthRef: string, userId: number): Promise<number> {
  const { year, month } = parseMonthRef(monthRef);
  const referenceMonth = monthRefToDate(monthRef);
  const templates = await pool.query<{
    id: number;
    description: string;
    category: string;
    default_amount: string;
    due_day: number;
    start_month: string | null;
    notes: string;
  }>(
    `SELECT id, description, category, default_amount::text AS default_amount, due_day, start_month::text AS start_month, notes
     FROM financial_expense_templates
     WHERE active = true
       AND COALESCE(start_month, $1::date) <= $1::date
     ORDER BY description ASC`,
    [referenceMonth],
  );

  let generatedCount = 0;
  for (const template of templates.rows) {
    const amount = Number(template.default_amount ?? 0);
    const dueDate = buildDueDate(year, month, Number(template.due_day ?? 1));
    const updated = await pool.query(
      `UPDATE financial_entries
       SET description = $1,
           category = $2,
           due_date = $3::date,
           notes = $4,
           updated_by = $5,
           updated_at = NOW()
       WHERE template_id = $6
         AND reference_month = $7::date`,
      [template.description, template.category ?? "", dueDate, template.notes ?? "", userId, template.id, referenceMonth],
    );
    if (updated.rowCount === 0) {
      await pool.query(
        `INSERT INTO financial_entries (
          entry_type, description, category, amount, entry_date, due_date, reference_month, template_id, notes, created_by, updated_by, updated_at
        )
        VALUES ('despesa', $1, $2, $3, $4::date, $5::date, $4::date, $6, $7, $8, $8, NOW())`,
        [template.description, template.category ?? "", amount, referenceMonth, dueDate, template.id, template.notes ?? "", userId],
      );
    }
    generatedCount += 1;
  }
  return generatedCount;
}

function entryStatus(row: { paid_at: string | null; due_date: string | null }): "pago" | "pendente" | "atrasado" {
  if (row.paid_at) return "pago";
  if (!row.due_date) return "pendente";
  const today = new Date().toISOString().slice(0, 10);
  return row.due_date < today ? "atrasado" : "pendente";
}

async function ensureFinanceStructures(): Promise<void> {
  if (financeStructureEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS financial_entries (
      id SERIAL PRIMARY KEY,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('receita', 'despesa')),
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      entry_date DATE NOT NULL,
      due_date DATE,
      reference_month DATE,
      paid_at TIMESTAMPTZ,
      paid_amount NUMERIC(14,2),
      template_id INT,
      notes TEXT NOT NULL DEFAULT '',
      created_by INT REFERENCES users(id),
      updated_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS financial_expense_templates (
      id SERIAL PRIMARY KEY,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      default_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (default_amount >= 0),
      due_day INT NOT NULL CHECK (due_day BETWEEN 1 AND 31),
      start_month DATE NOT NULL DEFAULT date_trunc('month', now())::date,
      is_variable BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT NOT NULL DEFAULT '',
      created_by INT REFERENCES users(id),
      updated_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE financial_entries ADD COLUMN IF NOT EXISTS due_date DATE;`);
  await pool.query(`ALTER TABLE financial_entries ADD COLUMN IF NOT EXISTS reference_month DATE;`);
  await pool.query(`ALTER TABLE financial_entries ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE financial_entries ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2);`);
  await pool.query(`ALTER TABLE financial_entries ADD COLUMN IF NOT EXISTS template_id INT;`);
  await pool.query(`ALTER TABLE financial_entries ADD COLUMN IF NOT EXISTS installment_group_key TEXT;`);
  await pool.query(`ALTER TABLE financial_entries ADD COLUMN IF NOT EXISTS installment_index INT;`);
  await pool.query(`ALTER TABLE financial_entries ADD COLUMN IF NOT EXISTS installment_total INT;`);
  await pool.query(`ALTER TABLE financial_expense_templates ADD COLUMN IF NOT EXISTS start_month DATE;`);
  await pool.query(`UPDATE financial_expense_templates SET start_month = date_trunc('month', now())::date WHERE start_month IS NULL;`);
  await pool.query(`ALTER TABLE financial_expense_templates ALTER COLUMN start_month SET NOT NULL;`);
  await pool.query(`ALTER TABLE financial_entries DROP CONSTRAINT IF EXISTS financial_entries_template_fk;`);
  await pool.query(`
    ALTER TABLE financial_entries
    ADD CONSTRAINT financial_entries_template_fk
    FOREIGN KEY (template_id) REFERENCES financial_expense_templates(id) ON DELETE SET NULL;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_financial_entries_date ON financial_entries(entry_date DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_financial_entries_type ON financial_entries(entry_type);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_financial_entries_due_date ON financial_entries(due_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_financial_entries_reference_month ON financial_entries(reference_month);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_financial_entries_installment_group ON financial_entries(installment_group_key, installment_index);`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_entries_template_month
    ON financial_entries(template_id, reference_month)
    WHERE template_id IS NOT NULL;
  `);
  financeStructureEnsured = true;
}

financeRouter.use(requireAuth);

financeRouter.get("/entries", async (req, res) => {
  await ensureFinanceStructures();
  const user = req.user!;
  const query = z
    .object({
      monthRef: monthRefSchema.optional(),
      type: entryTypeSchema.optional(),
    })
    .parse(req.query);

  const whereParts: string[] = [];
  const params: Array<string> = [];
  if (query.monthRef) {
    await upsertExpenseTemplatesForMonth(query.monthRef, user.id);
    const [year, month] = query.monthRef.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(Date.UTC(year, month, 1));
    const end = endDate.toISOString().slice(0, 10);
    params.push(start, end);
    const startParam = params.length - 1;
    const endParam = params.length;
    whereParts.push(`(
      (f.entry_type = 'receita' AND f.entry_date >= $${startParam}::date AND f.entry_date < $${endParam}::date)
      OR
      (
        f.entry_type = 'despesa'
        AND COALESCE(f.reference_month, f.due_date, f.entry_date) >= $${startParam}::date
        AND COALESCE(f.reference_month, f.due_date, f.entry_date) < $${endParam}::date
      )
    )`);
  }
  if (query.type) {
    params.push(query.type);
    whereParts.push(`f.entry_type = $${params.length}`);
  }
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const result = await pool.query<{
    id: number;
    entry_type: "receita" | "despesa";
    description: string;
    category: string;
    amount: string;
    entry_date: string;
      due_date: string | null;
      reference_month: string | null;
      paid_at: string | null;
      paid_amount: string | null;
      template_id: number | null;
    notes: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
      f.id,
      f.entry_type,
      f.description,
      f.category,
      f.amount::text AS amount,
      f.entry_date::text AS entry_date,
      f.due_date::text AS due_date,
      f.reference_month::text AS reference_month,
      f.paid_at::text AS paid_at,
      f.paid_amount::text AS paid_amount,
      f.template_id,
      f.notes,
      f.created_at,
      f.updated_at
    FROM financial_entries f
    ${whereClause}
    ORDER BY f.entry_date DESC, f.id DESC`,
    params,
  );

  const totalsResult = await pool.query<{
    receitas_total: string;
    despesas_total: string;
  }>(
    `SELECT
      COALESCE(SUM(CASE WHEN f.entry_type = 'receita' THEN f.amount ELSE 0 END), 0)::text AS receitas_total,
      COALESCE(SUM(CASE WHEN f.entry_type = 'despesa' THEN f.amount ELSE 0 END), 0)::text AS despesas_total
    FROM financial_entries f
    ${whereClause}`,
    params,
  );

  const totals = totalsResult.rows[0] ?? { receitas_total: "0", despesas_total: "0" };
  res.json({
    items: result.rows.map((row) => ({
      id: Number(row.id),
      type: row.entry_type,
      description: row.description,
      category: row.category ?? "",
      amount: Number(row.amount ?? 0),
      entryDate: row.entry_date,
      dueDate: row.due_date,
      referenceMonth: row.reference_month ? row.reference_month.slice(0, 7) : null,
      paidAt: row.paid_at,
      paidAmount: row.paid_amount ? Number(row.paid_amount) : null,
      templateId: row.template_id ? Number(row.template_id) : null,
      status: entryStatus(row),
      notes: row.notes ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    totals: {
      receitas: Number(totals.receitas_total ?? 0),
      despesas: Number(totals.despesas_total ?? 0),
      saldo: Number(totals.receitas_total ?? 0) - Number(totals.despesas_total ?? 0),
    },
  });
});

financeRouter.post("/entries", async (req, res) => {
  await ensureFinanceStructures();
  const user = req.user!;
  const payload = entryPayloadSchema.parse(req.body);
  const installmentsCount = payload.type === "despesa" ? Math.max(1, payload.installmentsCount ?? 1) : 1;
  const installmentFrequency = payload.installmentFrequency ?? "mensal";
  const frequencyMonthsStep = installmentFrequency === "anual" ? 12 : installmentFrequency === "trimestral" ? 3 : 1;
  const installmentAmounts = splitAmountByInstallments(payload.amount, installmentsCount);

  if (installmentsCount > 1 && !payload.dueDate) {
    res.status(400).json({ message: "Informe o vencimento para lançar despesa parcelada." });
    return;
  }
  const createdItems: Array<{
    id: number;
    entry_type: "receita" | "despesa";
    description: string;
    category: string;
    amount: string;
    entry_date: string;
    due_date: string | null;
    reference_month: string | null;
    paid_at: string | null;
    paid_amount: string | null;
    template_id: number | null;
    notes: string;
    created_at: string;
    updated_at: string;
  }> = [];

  for (let index = 0; index < installmentsCount; index += 1) {
    const isInstallment = installmentsCount > 1;
    const dueDateForInstallment =
      payload.type === "despesa" && payload.dueDate ? addMonthsToIsoDate(payload.dueDate, index * frequencyMonthsStep) : payload.dueDate ?? null;
    const referenceMonthForInstallment = dueDateForInstallment
      ? `${dueDateForInstallment.slice(0, 7)}-01`
      : payload.type === "despesa"
        ? monthRefToDate(payload.entryDate.slice(0, 7))
        : payload.referenceMonth
          ? monthRefToDate(payload.referenceMonth)
          : null;
    const descriptionForInstallment = isInstallment ? `${payload.description} (${index + 1}/${installmentsCount})` : payload.description;

    const created = await pool.query<{
      id: number;
      entry_type: "receita" | "despesa";
      description: string;
      category: string;
      amount: string;
      entry_date: string;
      due_date: string | null;
      reference_month: string | null;
      paid_at: string | null;
      paid_amount: string | null;
      template_id: number | null;
      notes: string;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO financial_entries (
        entry_type, description, category, amount, entry_date, due_date, reference_month, paid_at, paid_amount, template_id, notes, created_by, updated_by, updated_at
      )
      VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::date, $8::date, $9, $10, $11, $12, $12, NOW())
      RETURNING
        id,
        entry_type,
        description,
        category,
        amount::text AS amount,
        entry_date::text AS entry_date,
        due_date::text AS due_date,
        reference_month::text AS reference_month,
        paid_at::text AS paid_at,
        paid_amount::text AS paid_amount,
        template_id,
        notes,
        created_at,
        updated_at`,
      [
        payload.type,
        descriptionForInstallment,
        payload.category,
        installmentAmounts[index] ?? payload.amount,
        payload.entryDate,
        dueDateForInstallment,
        referenceMonthForInstallment,
        payload.paidAt ?? null,
        payload.paidAmount ?? null,
        payload.templateId ?? null,
        payload.notes,
        user.id,
      ],
    );
    createdItems.push(created.rows[0]);
  }

  const item = createdItems[0];
  await createAuditLog({
    actorUserId: user.id,
    action: "finance.entry.create",
    targetType: "financial_entry",
    targetId: Number(item.id),
    details: {
      type: payload.type,
      amount: payload.amount,
      entryDate: payload.entryDate,
      installmentsCount,
      installmentFrequency: installmentsCount > 1 ? installmentFrequency : null,
    },
  });

  res.status(201).json({
    id: Number(item.id),
    type: item.entry_type,
    description: item.description,
    category: item.category ?? "",
    amount: Number(item.amount ?? 0),
    entryDate: item.entry_date,
    dueDate: item.due_date,
    referenceMonth: item.reference_month ? item.reference_month.slice(0, 7) : null,
    paidAt: item.paid_at,
    paidAmount: item.paid_amount ? Number(item.paid_amount) : null,
    templateId: item.template_id ? Number(item.template_id) : null,
    status: entryStatus(item),
    notes: item.notes ?? "",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    createdCount: createdItems.length,
    installmentFrequency: createdItems.length > 1 ? installmentFrequency : null,
  });
});

financeRouter.put("/entries/:id", async (req, res) => {
  await ensureFinanceStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = entryPayloadSchema.parse(req.body);

  const updated = await pool.query<{
    id: number;
    entry_type: "receita" | "despesa";
    description: string;
    category: string;
    amount: string;
    entry_date: string;
    due_date: string | null;
    reference_month: string | null;
    paid_at: string | null;
    paid_amount: string | null;
    template_id: number | null;
    notes: string;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE financial_entries
     SET entry_type = $1,
         description = $2,
         category = $3,
         amount = $4,
         entry_date = $5::date,
         due_date = $6::date,
         reference_month = $7::date,
         paid_at = $8::date,
         paid_amount = $9,
         template_id = $10,
         notes = $11,
         updated_by = $12,
         updated_at = NOW()
     WHERE id = $13
     RETURNING
      id,
      entry_type,
      description,
      category,
      amount::text AS amount,
      entry_date::text AS entry_date,
      due_date::text AS due_date,
      reference_month::text AS reference_month,
      paid_at::text AS paid_at,
      paid_amount::text AS paid_amount,
      template_id,
      notes,
      created_at,
      updated_at`,
    [
      payload.type,
      payload.description,
      payload.category,
      payload.amount,
      payload.entryDate,
      payload.dueDate ?? null,
      payload.referenceMonth ? monthRefToDate(payload.referenceMonth) : null,
      payload.paidAt ?? null,
      payload.paidAmount ?? null,
      payload.templateId ?? null,
      payload.notes,
      user.id,
      params.id,
    ],
  );

  const item = updated.rows[0];
  if (!item) {
    res.status(404).json({ message: "Lançamento financeiro não encontrado." });
    return;
  }

  await createAuditLog({
    actorUserId: user.id,
    action: "finance.entry.update",
    targetType: "financial_entry",
    targetId: params.id,
    details: {
      type: payload.type,
      amount: payload.amount,
      entryDate: payload.entryDate,
    },
  });

  res.json({
    id: Number(item.id),
    type: item.entry_type,
    description: item.description,
    category: item.category ?? "",
    amount: Number(item.amount ?? 0),
    entryDate: item.entry_date,
    dueDate: item.due_date,
    referenceMonth: item.reference_month ? item.reference_month.slice(0, 7) : null,
    paidAt: item.paid_at,
    paidAmount: item.paid_amount ? Number(item.paid_amount) : null,
    templateId: item.template_id ? Number(item.template_id) : null,
    status: entryStatus(item),
    notes: item.notes ?? "",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  });
});

financeRouter.delete("/entries/:id", async (req, res) => {
  await ensureFinanceStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = z
    .object({
      scope: deleteScopeSchema.default("single"),
    })
    .parse(req.body ?? {});

  const target = await pool.query<{
    id: number;
    description: string;
    category: string;
    template_id: number | null;
    due_date: string | null;
    reference_month: string | null;
    entry_date: string;
  }>(
    `SELECT id, description, category, template_id, due_date::text AS due_date, reference_month::text AS reference_month, entry_date::text AS entry_date
     FROM financial_entries
     WHERE id = $1`,
    [params.id],
  );
  const targetRow = target.rows[0];
  if (!targetRow) {
    res.status(404).json({ message: "Lançamento financeiro não encontrado." });
    return;
  }

  let deletedCount = 0;
  if (payload.scope === "from_current") {
    if (targetRow.template_id) {
      const currentReferenceDate = targetRow.reference_month ?? targetRow.due_date ?? targetRow.entry_date;
      const deleted = await pool.query<{ id: number }>(
        `DELETE FROM financial_entries
         WHERE template_id = $1
           AND COALESCE(reference_month, due_date, entry_date) >= $2::date
         RETURNING id`,
        [targetRow.template_id, currentReferenceDate],
      );
      deletedCount = deleted.rowCount ?? 0;
      await pool.query(
        `UPDATE financial_expense_templates
         SET active = false,
             updated_by = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [user.id, targetRow.template_id],
      );
    } else {
      const parsed = targetRow.description.match(/^(.*)\s\((\d+)\/(\d+)\)$/);
      if (parsed) {
        const baseDescription = (parsed[1] ?? "").trim();
        const currentIndex = Number(parsed[2] ?? "0");
        const totalCount = Number(parsed[3] ?? "0");
        const candidates = await pool.query<{ id: number; description: string }>(
          `SELECT id, description
           FROM financial_entries
           WHERE category = $1
             AND description LIKE $2`,
          [targetRow.category ?? "", `${baseDescription} (%/${totalCount})`],
        );
        const idsToDelete = candidates.rows
          .map((row) => {
            const rowMatch = row.description.match(/\((\d+)\/(\d+)\)$/);
            if (!rowMatch) return null;
            const rowIndex = Number(rowMatch[1] ?? "0");
            const rowTotal = Number(rowMatch[2] ?? "0");
            if (rowTotal !== totalCount || rowIndex < currentIndex) return null;
            return row.id;
          })
          .filter((id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0);

        if (idsToDelete.length > 0) {
          const deleted = await pool.query<{ id: number }>(`DELETE FROM financial_entries WHERE id = ANY($1::int[]) RETURNING id`, [
            idsToDelete,
          ]);
          deletedCount = deleted.rowCount ?? 0;
        }
      }
    }
  } else {
    const deleted = await pool.query<{ id: number }>(`DELETE FROM financial_entries WHERE id = $1 RETURNING id`, [params.id]);
    deletedCount = deleted.rowCount ?? 0;
  }

  if (deletedCount === 0 && payload.scope === "from_current") {
    const deletedFallback = await pool.query<{ id: number }>(`DELETE FROM financial_entries WHERE id = $1 RETURNING id`, [params.id]);
    deletedCount = deletedFallback.rowCount ?? 0;
  }

  if (deletedCount === 0) {
    res.status(404).json({ message: "Lançamento financeiro não encontrado." });
    return;
  }

  await createAuditLog({
    actorUserId: user.id,
    action: "finance.entry.delete",
    targetType: "financial_entry",
    targetId: params.id,
    details: {
      scope: payload.scope,
      deletedCount,
    },
  });
  res.json({ deletedCount });
});

financeRouter.patch("/entries/:id/pay", async (req, res) => {
  await ensureFinanceStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = z
    .object({
      paidAt: optionalDateSchema,
      paidAmount: z.coerce.number().positive().optional(),
    })
    .parse(req.body ?? {});

  const paidAt = payload.paidAt ?? new Date().toISOString().slice(0, 10);
  const updated = await pool.query<{
    id: number;
    paid_at: string | null;
    paid_amount: string | null;
  }>(
    `UPDATE financial_entries
     SET paid_at = $1::date,
         paid_amount = COALESCE($2, paid_amount, amount),
         updated_by = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING id, paid_at::text AS paid_at, paid_amount::text AS paid_amount`,
    [paidAt, payload.paidAmount ?? null, user.id, params.id],
  );
  if (!updated.rows[0]) {
    res.status(404).json({ message: "Lançamento financeiro não encontrado." });
    return;
  }
  await createAuditLog({
    actorUserId: user.id,
    action: "finance.entry.pay",
    targetType: "financial_entry",
    targetId: params.id,
    details: {
      paidAt,
      paidAmount: payload.paidAmount ?? null,
    },
  });
  res.json({ ok: true });
});

financeRouter.get("/expense-templates", async (_req, res) => {
  await ensureFinanceStructures();
  const result = await pool.query<{
    id: number;
    description: string;
    category: string;
    default_amount: string;
    due_day: number;
    start_month: string | null;
    is_variable: boolean;
    active: boolean;
    notes: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, description, category, default_amount::text AS default_amount, due_day, start_month::text AS start_month, is_variable, active, notes, created_at, updated_at
     FROM financial_expense_templates
     ORDER BY active DESC, description ASC`,
  );
  res.json(
    result.rows.map((row) => ({
      id: Number(row.id),
      description: row.description,
      category: row.category ?? "",
      defaultAmount: Number(row.default_amount ?? 0),
      dueDay: Number(row.due_day ?? 1),
      startMonth: row.start_month ? row.start_month.slice(0, 7) : null,
      isVariable: Boolean(row.is_variable),
      active: Boolean(row.active),
      notes: row.notes ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  );
});

financeRouter.post("/expense-templates", async (req, res) => {
  await ensureFinanceStructures();
  const user = req.user!;
  const payload = templatePayloadSchema.parse(req.body);
  const created = await pool.query<{
    id: number;
    description: string;
    category: string;
    default_amount: string;
    due_day: number;
    start_month: string | null;
    is_variable: boolean;
    active: boolean;
    notes: string;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO financial_expense_templates (
      description, category, default_amount, due_day, start_month, is_variable, active, notes, created_by, updated_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $9, NOW())
    RETURNING id, description, category, default_amount::text AS default_amount, due_day, start_month::text AS start_month, is_variable, active, notes, created_at, updated_at`,
    [
      payload.description,
      payload.category,
      payload.defaultAmount,
      payload.dueDay,
      payload.startMonth ? monthRefToDate(payload.startMonth) : `${new Date().toISOString().slice(0, 7)}-01`,
      payload.isVariable,
      payload.active,
      payload.notes,
      user.id,
    ],
  );
  res.status(201).json({
    id: Number(created.rows[0].id),
    description: created.rows[0].description,
    category: created.rows[0].category ?? "",
    defaultAmount: Number(created.rows[0].default_amount ?? 0),
    dueDay: Number(created.rows[0].due_day ?? 1),
    startMonth: created.rows[0].start_month ? created.rows[0].start_month.slice(0, 7) : null,
    isVariable: Boolean(created.rows[0].is_variable),
    active: Boolean(created.rows[0].active),
    notes: created.rows[0].notes ?? "",
    createdAt: created.rows[0].created_at,
    updatedAt: created.rows[0].updated_at,
  });
});

financeRouter.put("/expense-templates/:id", async (req, res) => {
  await ensureFinanceStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = templatePayloadSchema.parse(req.body);
  const updated = await pool.query<{
    id: number;
    description: string;
    category: string;
    default_amount: string;
    due_day: number;
    start_month: string | null;
    is_variable: boolean;
    active: boolean;
    notes: string;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE financial_expense_templates
     SET description = $1,
         category = $2,
         default_amount = $3,
         due_day = $4,
         start_month = COALESCE($5::date, start_month),
         is_variable = $6,
         active = $7,
         notes = $8,
         updated_by = $9,
         updated_at = NOW()
     WHERE id = $10
     RETURNING id, description, category, default_amount::text AS default_amount, due_day, start_month::text AS start_month, is_variable, active, notes, created_at, updated_at`,
    [
      payload.description,
      payload.category,
      payload.defaultAmount,
      payload.dueDay,
      payload.startMonth ? monthRefToDate(payload.startMonth) : null,
      payload.isVariable,
      payload.active,
      payload.notes,
      user.id,
      params.id,
    ],
  );
  if (!updated.rows[0]) {
    res.status(404).json({ message: "Modelo de despesa não encontrado." });
    return;
  }
  res.json({
    id: Number(updated.rows[0].id),
    description: updated.rows[0].description,
    category: updated.rows[0].category ?? "",
    defaultAmount: Number(updated.rows[0].default_amount ?? 0),
    dueDay: Number(updated.rows[0].due_day ?? 1),
    startMonth: updated.rows[0].start_month ? updated.rows[0].start_month.slice(0, 7) : null,
    isVariable: Boolean(updated.rows[0].is_variable),
    active: Boolean(updated.rows[0].active),
    notes: updated.rows[0].notes ?? "",
    createdAt: updated.rows[0].created_at,
    updatedAt: updated.rows[0].updated_at,
  });
});

financeRouter.delete("/expense-templates/:id", async (req, res) => {
  await ensureFinanceStructures();
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const deleted = await pool.query(`DELETE FROM financial_expense_templates WHERE id = $1 RETURNING id`, [params.id]);
  if (deleted.rowCount === 0) {
    res.status(404).json({ message: "Modelo de despesa não encontrado." });
    return;
  }
  res.status(204).send();
});

financeRouter.post("/expense-templates/generate-month", async (req, res) => {
  await ensureFinanceStructures();
  const user = req.user!;
  const payload = z.object({ monthRef: monthRefSchema }).parse(req.body);
  const generatedCount = await upsertExpenseTemplatesForMonth(payload.monthRef, user.id);

  await createAuditLog({
    actorUserId: user.id,
    action: "finance.expense.generate_month",
    targetType: "financial_entry",
    targetId: null,
    details: {
      monthRef: payload.monthRef,
      templates: generatedCount,
    },
  });
  res.status(201).json({ generatedCount });
});

financeRouter.get("/payables/overview", async (req, res) => {
  await ensureFinanceStructures();
  const query = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .parse(req.query);
  const baseDate = query.date ?? new Date().toISOString().slice(0, 10);
  const todayDue = await pool.query<{
    id: number;
    description: string;
    amount: string;
    due_date: string;
  }>(
    `SELECT id, description, amount::text AS amount, due_date::text AS due_date
     FROM financial_entries
     WHERE entry_type = 'despesa'
       AND paid_at IS NULL
       AND due_date = $1::date
     ORDER BY id DESC`,
    [baseDate],
  );
  const overdue = await pool.query<{
    id: number;
    description: string;
    amount: string;
    due_date: string;
  }>(
    `SELECT id, description, amount::text AS amount, due_date::text AS due_date
     FROM financial_entries
     WHERE entry_type = 'despesa'
       AND paid_at IS NULL
       AND due_date < $1::date
     ORDER BY due_date ASC, id ASC`,
    [baseDate],
  );
  res.json({
    date: baseDate,
    dueToday: todayDue.rows.map((row) => ({
      id: Number(row.id),
      description: row.description,
      amount: Number(row.amount ?? 0),
      dueDate: row.due_date,
    })),
    overdue: overdue.rows.map((row) => ({
      id: Number(row.id),
      description: row.description,
      amount: Number(row.amount ?? 0),
      dueDate: row.due_date,
    })),
  });
});

export { financeRouter };
