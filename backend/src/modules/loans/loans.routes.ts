import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { createAuditLog } from "../audit/audit.service";

const clientStatusValues = [
  "novo",
  "em_atendimento",
  "simulacao",
  "em_analise",
  "digitacao",
  "seguro_ap",
  "assinatura",
  "pagamento",
  "ganho",
  "perdido",
] as const;

const productTypeValues = ["credito", "seguros", "capitalizacao", "imobiliario"] as const;

const clientSchema = z.object({
  name: z.string().trim().min(2),
  cpf: z.string().trim().min(11),
  phones: z.array(z.string().trim().min(8)).min(1),
  city: z.string().trim().default(""),
  profession: z.string().trim().default(""),
  convenio: z.string().trim().default(""),
  income: z.coerce.number().min(0).default(0),
  heatBadge: z.enum(["Quente", "Morno", "Frio"]).nullable().optional(),
  source: z.string().trim().min(2),
  status: z.enum(clientStatusValues).default("novo"),
  assignedUserId: z.coerce.number().int().positive().optional(),
});

const interactionSchema = z.object({
  notes: z.string().trim().min(2),
  channel: z.string().trim().default("manual"),
  scheduledFor: z.string().datetime().optional().nullable(),
});

const simulationSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  productType: z.enum(productTypeValues),
  principal: z.coerce.number().positive(),
  installments: z.coerce.number().int().positive(),
  monthlyRate: z.coerce.number().positive(),
});

const productSchema = z.object({
  name: z.string().trim().min(2),
  productType: z.enum(productTypeValues),
  defaultRate: z.coerce.number().min(0),
  minTerm: z.coerce.number().int().positive(),
  maxTerm: z.coerce.number().int().positive(),
  active: z.boolean().default(true),
});

const importSchema = z.object({
  source: z.string().trim().min(2),
  leads: z.array(clientSchema).max(500),
});
const settingsSchema = z
  .object({
    consignableMarginPercent: z.coerce.number().min(1).max(100).optional(),
    consignadoRate: z.coerce.number().min(0.1).max(20).optional(),
    pessoalRate: z.coerce.number().min(0.1).max(20).optional(),
  })
  .refine(
    (payload) =>
      payload.consignableMarginPercent !== undefined ||
      payload.consignadoRate !== undefined ||
      payload.pessoalRate !== undefined,
    {
      message: "Informe ao menos um campo para atualizar.",
    },
  );

function normalizeCpf(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 || digits.length === 10) return digits;
  throw new Error("Telefone invalido. Use DDD + numero.");
}

function formatCpf(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function parseLossNote(rawNotes: string | null): { reason: string | null; hasMargin: boolean | null } {
  if (!rawNotes) return { reason: null, hasMargin: null };
  const normalized = rawNotes.trim();
  const prefix = "Motivo da perda:";
  const withoutPrefix = normalized.toLowerCase().startsWith(prefix.toLowerCase())
    ? normalized.slice(prefix.length).trim()
    : normalized;
  const marginMatch = withoutPrefix.match(/\|\s*Possui margem:\s*(sim|não|nao)\s*$/i);
  const hasMargin =
    marginMatch?.[1]?.toLowerCase() === "sim"
      ? true
      : marginMatch?.[1]
        ? false
        : null;
  const reason = marginMatch
    ? withoutPrefix.slice(0, marginMatch.index).trim() || null
    : withoutPrefix || null;
  return { reason, hasMargin };
}

function pmt(principal: number, monthlyRatePercent: number, installments: number): number {
  const rate = monthlyRatePercent / 100;
  const numerator = principal * rate;
  const denominator = 1 - (1 + rate) ** -installments;
  return numerator / denominator;
}

const loansRouter = Router();
let loanClientStructureEnsured = false;

async function ensureLoanSettingsTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS loan_settings (
      key TEXT PRIMARY KEY,
      value_text TEXT NOT NULL,
      updated_by INT REFERENCES users(id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
  await pool.query(
    `INSERT INTO loan_settings (key, value_text)
     VALUES ('consignable_margin_percent', '30')
     ON CONFLICT (key) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO loan_settings (key, value_text)
     VALUES ('consignado_rate', '1.8'), ('pessoal_rate', '3.5')
     ON CONFLICT (key) DO NOTHING`,
  );
}

async function ensureLoanClientStructures(): Promise<void> {
  if (loanClientStructureEnsured) return;
  await pool.query(
    `ALTER TABLE loan_clients
     ADD COLUMN IF NOT EXISTS profession TEXT NOT NULL DEFAULT ''`,
  );
  await pool.query(
    `ALTER TABLE loan_clients
     ADD COLUMN IF NOT EXISTS convenio TEXT NOT NULL DEFAULT ''`,
  );
  await pool.query(
    `ALTER TABLE loan_clients
     ADD COLUMN IF NOT EXISTS heat_badge TEXT CHECK (heat_badge IN ('Quente', 'Morno', 'Frio'))`,
  );
  await pool.query(`ALTER TABLE loan_interactions ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE loan_interactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_loan_interactions_scheduled_for ON loan_interactions(scheduled_for)`,
  );
  await pool.query(
    `ALTER TABLE loan_clients DROP CONSTRAINT IF EXISTS loan_clients_status_check`,
  );
  await pool.query(
    `UPDATE loan_clients
     SET status = CASE
       WHEN status = 'proposta_enviada' THEN 'em_analise'
       WHEN status = 'fechado' THEN 'ganho'
       ELSE status
     END
     WHERE status IN ('proposta_enviada', 'fechado')`,
  );
  await pool.query(
    `ALTER TABLE loan_clients
     ADD CONSTRAINT loan_clients_status_check
     CHECK (
       status IN (
         'novo',
         'em_atendimento',
         'simulacao',
         'em_analise',
         'digitacao',
         'seguro_ap',
         'assinatura',
         'pagamento',
         'ganho',
         'perdido'
       )
     )`,
  );
  loanClientStructureEnsured = true;
}

loansRouter.get("/dashboard", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const query = z
    .object({
      monthRef: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    })
    .parse(req.query);
  const params: Array<number | string> = [];
  let scope = "WHERE deleted_at IS NULL";
  if (query.monthRef) {
    params.push(`${query.monthRef}-01`);
    scope += ` AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', $${params.length}::date)`;
  }

  const [totals, status, byDay, products] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total_clients,
         COUNT(*) FILTER (WHERE status = 'ganho')::int AS conversions,
         COUNT(*) FILTER (WHERE status = 'ganho')::int AS won_clients,
         COUNT(*) FILTER (WHERE status = 'perdido')::int AS lost_clients,
         COUNT(*) FILTER (
           WHERE COALESCE(last_contact_at, created_at) < NOW() - INTERVAL '3 days'
         )::int AS no_contact_clients
       FROM loan_clients
       ${scope}`,
      params,
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS total
       FROM loan_clients
       ${scope}
       GROUP BY status`,
      params,
    ),
    pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*)::int AS total
       FROM loan_interactions
       WHERE created_at >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(created_at)
       ORDER BY day DESC`,
    ),
    pool.query(
      `SELECT product_type, COUNT(*)::int AS total
       FROM loan_simulations
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY product_type
       ORDER BY total DESC`,
    ),
  ]);

  res.json({
    totalClients: totals.rows[0]?.total_clients ?? 0,
    conversions: totals.rows[0]?.conversions ?? 0,
    wonClients: totals.rows[0]?.won_clients ?? 0,
    lostClients: totals.rows[0]?.lost_clients ?? 0,
    noContactClients: totals.rows[0]?.no_contact_clients ?? 0,
    statusBreakdown: status.rows,
    interactionsByDay: byDay.rows,
    productsMostSold: products.rows,
  });
});

loansRouter.get("/reports/funnel-outcomes", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const query = z
    .object({
      monthRef: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    })
    .parse(req.query);
  const params: Array<string> = [];
  let scope = "c.deleted_at IS NULL AND c.status IN ('ganho', 'perdido')";
  if (query.monthRef) {
    params.push(`${query.monthRef}-01`);
    scope += ` AND DATE_TRUNC('month', c.updated_at) = DATE_TRUNC('month', $${params.length}::date)`;
  }

  const result = await pool.query<{
    id: number;
    name: string;
    cpf: string;
    city: string;
    profession: string;
    convenio: string;
    income: string;
    source: string;
    status: "ganho" | "perdido";
    assignedUserName: string | null;
    updatedAt: string;
    lastLossInteractionAt: string | null;
    lastLossNotes: string | null;
    phones: string[];
  }>(
    `SELECT
      c.id,
      c.name,
      c.cpf,
      c.city,
      c.profession,
      c.convenio,
      c.income::text AS income,
      c.source,
      c.status,
      u.name AS "assignedUserName",
      c.updated_at AS "updatedAt",
      loss.created_at AS "lastLossInteractionAt",
      loss.notes AS "lastLossNotes",
      COALESCE(phones.phones, ARRAY[]::text[]) AS phones
    FROM loan_clients c
    LEFT JOIN users u ON u.id = c.assigned_user_id
    LEFT JOIN LATERAL (
      SELECT ARRAY_AGG(p.phone ORDER BY p.id) AS phones
      FROM loan_client_phones p
      WHERE p.client_id = c.id
    ) phones ON TRUE
    LEFT JOIN LATERAL (
      SELECT i.notes, i.created_at
      FROM loan_interactions i
      WHERE i.client_id = c.id
        AND i.notes ILIKE 'Motivo da perda:%'
      ORDER BY i.created_at DESC
      LIMIT 1
    ) loss ON TRUE
    WHERE ${scope}
    ORDER BY c.updated_at DESC, c.id DESC`,
    params,
  );

  const items = result.rows.map((row) => {
    const parsedLoss = parseLossNote(row.lastLossNotes);
    return {
      id: row.id,
      name: row.name,
      cpf: formatCpf(String(row.cpf ?? "")),
      phones: Array.isArray(row.phones) ? row.phones.map((phone) => formatPhone(String(phone ?? ""))) : [],
      city: row.city ?? "",
      profession: row.profession ?? "",
      convenio: row.convenio ?? "",
      income: Number(row.income ?? 0),
      source: row.source ?? "",
      status: row.status,
      assignedUserName: row.assignedUserName ?? null,
      updatedAt: row.updatedAt,
      lastLossInteractionAt: row.lastLossInteractionAt,
      lostReason: row.status === "perdido" ? parsedLoss.reason : null,
      lostHasMargin: row.status === "perdido" ? parsedLoss.hasMargin : null,
    };
  });

  const ganho = items.filter((item) => item.status === "ganho").length;
  const perdido = items.filter((item) => item.status === "perdido").length;

  res.json({
    generatedAt: new Date().toISOString(),
    monthRef: query.monthRef ?? null,
    totals: {
      ganho,
      perdido,
      total: items.length,
    },
    items,
  });
});

loansRouter.get("/sellers", requireAuth, async (_req, res) => {
  const result = await pool.query(
    `SELECT id, name, email
     FROM users
     WHERE active = true
     ORDER BY name ASC`,
  );
  res.json(result.rows);
});

loansRouter.get("/agenda", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const query = z
    .object({
      monthRef: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      status: z.enum(["all", "pending", "completed"]).default("pending"),
    })
    .parse(req.query);
  const params: Array<number | string> = [];
  let scope = "c.deleted_at IS NULL AND i.scheduled_for IS NOT NULL";
  if (query.status === "pending") {
    scope += " AND i.completed_at IS NULL";
  } else if (query.status === "completed") {
    scope += " AND i.completed_at IS NOT NULL";
  }
  if (query.monthRef) {
    params.push(`${query.monthRef}-01`);
    scope += ` AND DATE_TRUNC('month', i.scheduled_for) = DATE_TRUNC('month', $${params.length}::date)`;
  }
  const result = await pool.query(
    `SELECT
      i.id,
      i.client_id AS "clientId",
      c.name AS "clientName",
      c.status AS status,
      c.assigned_user_id AS "assignedUserId",
      u.name AS "assignedUserName",
      i.channel,
      i.notes,
      i.scheduled_for AS "scheduledFor",
      i.completed_at AS "completedAt",
      i.created_at AS "createdAt"
    FROM loan_interactions i
    JOIN loan_clients c ON c.id = i.client_id
    LEFT JOIN users u ON u.id = c.assigned_user_id
    WHERE ${scope}
    ORDER BY i.scheduled_for ASC, i.id ASC`,
    params,
  );
  res.json(result.rows);
});

loansRouter.patch("/agenda/:id/complete", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const queryParams: Array<number> = [params.id];
  let scope = "i.id = $1 AND i.completed_at IS NULL";
  const result = await pool.query<{ id: number; client_id: number }>(
    `UPDATE loan_interactions i
     SET completed_at = NOW()
     FROM loan_clients c
     WHERE i.client_id = c.id
       AND ${scope}
     RETURNING i.id, i.client_id`,
    queryParams,
  );
  if (!result.rows[0]) {
    res.status(404).json({ message: "Agendamento nao encontrado." });
    return;
  }
  await createAuditLog({
    actorUserId: user.id,
    action: "loan.agenda.complete",
    targetType: "loan_client",
    targetId: Number(result.rows[0].client_id),
    details: { interactionId: params.id },
  });
  res.json({ ok: true });
});

loansRouter.patch("/agenda/:id/reschedule", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = z
    .object({
      scheduledFor: z.coerce.date(),
    })
    .parse(req.body);

  const queryParams: Array<number | string | Date> = [params.id, payload.scheduledFor];
  let scope = "i.id = $1";

  const result = await pool.query<{ id: number; client_id: number; scheduled_for: string }>(
    `UPDATE loan_interactions i
     SET scheduled_for = $2::timestamptz,
         completed_at = NULL
     FROM loan_clients c
     WHERE i.client_id = c.id
       AND ${scope}
     RETURNING i.id, i.client_id, i.scheduled_for`,
    queryParams,
  );

  if (!result.rows[0]) {
    res.status(404).json({ message: "Agendamento nao encontrado." });
    return;
  }

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.agenda.reschedule",
    targetType: "loan_client",
    targetId: Number(result.rows[0].client_id),
    details: { interactionId: params.id, scheduledFor: payload.scheduledFor.toISOString() },
  });
  res.json({ ok: true, scheduledFor: result.rows[0].scheduled_for });
});

loansRouter.get("/clients", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const query = z
    .object({
      search: z.string().trim().optional(),
      monthRef: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      status: z.enum(clientStatusValues).optional(),
      source: z.string().trim().optional(),
      assignedUserId: z.coerce.number().int().positive().optional(),
      sortBy: z
        .enum(["name", "cpf", "city", "profession", "convenio", "assignedUserName", "status", "updatedAt"])
        .default("updatedAt"),
      sortDir: z.enum(["asc", "desc"]).default("desc"),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(500).default(50),
    })
    .parse(req.query);
  const params: Array<number | string> = [];
  let scope = "c.deleted_at IS NULL";
  if (query.search) {
    const textSearch = `%${query.search}%`;
    params.push(textSearch);
    const nameParamIndex = params.length;
    const cpfDigits = query.search.replace(/\D/g, "");
    if (cpfDigits) {
      params.push(`%${cpfDigits}%`);
      scope += ` AND (c.name ILIKE $${nameParamIndex} OR c.cpf LIKE $${params.length})`;
    } else {
      scope += ` AND c.name ILIKE $${nameParamIndex}`;
    }
  }
  if (query.status) {
    params.push(query.status);
    scope += ` AND c.status = $${params.length}`;
  }
  if (query.source) {
    params.push(query.source);
    scope += ` AND c.source = $${params.length}`;
  }
  if (query.assignedUserId) {
    params.push(query.assignedUserId);
    scope += ` AND c.assigned_user_id = $${params.length}`;
  }
  if (query.monthRef) {
    params.push(`${query.monthRef}-01`);
    scope += ` AND DATE_TRUNC('month', c.created_at) = DATE_TRUNC('month', $${params.length}::date)`;
  }

  const totalResult = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total
     FROM loan_clients c
     WHERE ${scope}`,
    params,
  );
  const total = Number(totalResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.limit;
  const dataParams = [...params, query.limit, offset];
  const orderByMap: Record<typeof query.sortBy, string> = {
    name: "LOWER(c.name)",
    cpf: "c.cpf",
    city: "LOWER(c.city)",
    profession: "LOWER(c.profession)",
    convenio: "LOWER(c.convenio)",
    assignedUserName: `LOWER(COALESCE(MAX(u.name), ''))`,
    status: "c.status",
    updatedAt: "c.updated_at",
  };
  const sortDirection = query.sortDir === "asc" ? "ASC" : "DESC";
  const orderBy = orderByMap[query.sortBy];

  const result = await pool.query(
    `SELECT
      c.id,
      c.name,
      c.cpf,
      c.city,
      c.profession AS profession,
      c.convenio AS convenio,
      c.income,
      c.heat_badge AS "heatBadge",
      c.status,
      c.source,
      c.assigned_user_id AS "assignedUserId",
      MAX(u.name) AS "assignedUserName",
      c.created_at AS "createdAt",
      c.updated_at AS "updatedAt",
      c.last_contact_at AS "lastContactAt",
      COALESCE(
        ARRAY_AGG(p.phone ORDER BY p.id) FILTER (WHERE p.phone IS NOT NULL),
        ARRAY[]::text[]
      ) AS phones
    FROM loan_clients c
    LEFT JOIN loan_client_phones p ON p.client_id = c.id
    LEFT JOIN users u ON u.id = c.assigned_user_id
    WHERE ${scope}
    GROUP BY c.id
    ORDER BY ${orderBy} ${sortDirection}, c.updated_at DESC
    LIMIT $${dataParams.length - 1}
    OFFSET $${dataParams.length}`,
    dataParams,
  );

  const items = result.rows.map((row) => ({
    ...row,
    cpf: formatCpf(String(row.cpf ?? "")),
    phones: Array.isArray(row.phones)
      ? row.phones.map((phone: string) => formatPhone(String(phone ?? "")))
      : [],
  }));

  res.json({
    items,
    total,
    page,
    pageSize: query.limit,
    totalPages,
  });
});

loansRouter.get("/clients/:id", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const queryParams: Array<number> = [params.id];
  let scope = "c.id = $1 AND c.deleted_at IS NULL";
  const result = await pool.query(
    `SELECT
      c.id,
      c.name,
      c.cpf,
      c.city,
      c.profession AS profession,
      c.convenio AS convenio,
      c.income,
      c.heat_badge AS "heatBadge",
      c.status,
      c.source,
      c.assigned_user_id AS "assignedUserId",
      MAX(u.name) AS "assignedUserName",
      c.created_at AS "createdAt",
      c.updated_at AS "updatedAt",
      c.last_contact_at AS "lastContactAt",
      COALESCE(
        ARRAY_AGG(p.phone ORDER BY p.id) FILTER (WHERE p.phone IS NOT NULL),
        ARRAY[]::text[]
      ) AS phones
    FROM loan_clients c
    LEFT JOIN loan_client_phones p ON p.client_id = c.id
    LEFT JOIN users u ON u.id = c.assigned_user_id
    WHERE ${scope}
    GROUP BY c.id
    LIMIT 1`,
    queryParams,
  );
  if (!result.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }
  const row = result.rows[0];
  res.json({
    ...row,
    cpf: formatCpf(String(row.cpf ?? "")),
    phones: Array.isArray(row.phones) ? row.phones.map((phone: string) => formatPhone(String(phone ?? ""))) : [],
  });
});

loansRouter.post("/clients", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const payload = clientSchema.parse(req.body);
  const assignedUserId = payload.assignedUserId ?? user.id;
  const cpf = normalizeCpf(payload.cpf);
  const phones = Array.from(new Set(payload.phones.map(normalizePhone)));

  const assignedExists = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND active = true LIMIT 1`,
    [assignedUserId],
  );
  if (!assignedExists.rows[0]) {
    res.status(400).json({ message: "Vendedor invalido." });
    return;
  }

  const existingCpf = await pool.query(
    `SELECT id FROM loan_clients WHERE cpf = $1 AND deleted_at IS NULL LIMIT 1`,
    [cpf],
  );
  if (existingCpf.rows[0]) {
    res.status(409).json({ message: "CPF ja cadastrado." });
    return;
  }

  const existingPhone = await pool.query(
    `SELECT p.phone
     FROM loan_client_phones p
     JOIN loan_clients c ON c.id = p.client_id
     WHERE c.deleted_at IS NULL AND p.phone = ANY($1::text[])
     LIMIT 1`,
    [phones],
  );
  if (existingPhone.rows[0]) {
    res.status(409).json({ message: "Telefone ja cadastrado." });
    return;
  }

  const created = await pool.query(
    `INSERT INTO loan_clients (
      name, cpf, city, profession, convenio, income, heat_badge, status, source, assigned_user_id, created_by, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    RETURNING id`,
    [
      payload.name,
      cpf,
      payload.city,
      payload.profession,
      payload.convenio,
      payload.income,
      payload.heatBadge ?? null,
      payload.status,
      payload.source,
      assignedUserId,
      user.id,
    ],
  );
  const clientId = Number(created.rows[0].id);

  for (const phone of phones) {
    await pool.query(`INSERT INTO loan_client_phones (client_id, phone) VALUES ($1, $2)`, [
      clientId,
      phone,
    ]);
  }

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.client.create",
    targetType: "loan_client",
    targetId: clientId,
    details: { source: payload.source, status: payload.status },
  });

  res.status(201).json({ id: clientId });
});

loansRouter.patch("/clients/:id/status", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = z.object({ status: z.enum(clientStatusValues) }).parse(req.body);

  const result = await pool.query(
    `UPDATE loan_clients
     SET status = $1, last_contact_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [payload.status, params.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.client.status",
    targetType: "loan_client",
    targetId: params.id,
    details: { status: payload.status },
  });

  res.json({ ok: true });
});

loansRouter.patch("/clients/:id/heat-badge", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = z
    .object({
      heatBadge: z.enum(["Quente", "Morno", "Frio"]).nullable(),
    })
    .parse(req.body);
  const result = await pool.query(
    `UPDATE loan_clients
     SET heat_badge = $1, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [payload.heatBadge, params.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }
  await createAuditLog({
    actorUserId: user.id,
    action: "loan.client.heat_badge",
    targetType: "loan_client",
    targetId: params.id,
    details: { heatBadge: payload.heatBadge },
  });
  res.json({ ok: true });
});

loansRouter.put("/clients/:id", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = clientSchema.parse(req.body);
  const assignedUserId = payload.assignedUserId ?? user.id;
  const cpf = normalizeCpf(payload.cpf);
  const phones = Array.from(new Set(payload.phones.map(normalizePhone)));

  const assignedExists = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND active = true LIMIT 1`,
    [assignedUserId],
  );
  if (!assignedExists.rows[0]) {
    res.status(400).json({ message: "Vendedor invalido." });
    return;
  }

  const existingClient = await pool.query<{ id: number }>(
    `SELECT id
     FROM loan_clients
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [params.id],
  );
  if (!existingClient.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  const existingCpf = await pool.query<{ id: number }>(
    `SELECT id
     FROM loan_clients
     WHERE cpf = $1 AND deleted_at IS NULL AND id <> $2
     LIMIT 1`,
    [cpf, params.id],
  );
  if (existingCpf.rows[0]) {
    res.status(409).json({ message: "CPF ja cadastrado em outro cliente." });
    return;
  }

  const existingPhone = await pool.query<{ phone: string }>(
    `SELECT p.phone
     FROM loan_client_phones p
     JOIN loan_clients c ON c.id = p.client_id
     WHERE c.deleted_at IS NULL AND c.id <> $2 AND p.phone = ANY($1::text[])
     LIMIT 1`,
    [phones, params.id],
  );
  if (existingPhone.rows[0]) {
    res.status(409).json({ message: "Telefone ja cadastrado em outro cliente." });
    return;
  }

  await pool.query(
    `UPDATE loan_clients
     SET
      name = $1,
      cpf = $2,
      city = $3,
      profession = $4,
      convenio = $5,
      income = $6,
      heat_badge = $7,
      status = $8,
      source = $9,
      assigned_user_id = $10,
      updated_at = NOW()
     WHERE id = $11`,
    [
      payload.name,
      cpf,
      payload.city,
      payload.profession,
      payload.convenio,
      payload.income,
      payload.heatBadge ?? null,
      payload.status,
      payload.source,
      assignedUserId,
      params.id,
    ],
  );

  await pool.query(`DELETE FROM loan_client_phones WHERE client_id = $1`, [params.id]);
  for (const phone of phones) {
    await pool.query(`INSERT INTO loan_client_phones (client_id, phone) VALUES ($1, $2)`, [
      params.id,
      phone,
    ]);
  }

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.client.update",
    targetType: "loan_client",
    targetId: params.id,
    details: {
      status: payload.status,
      source: payload.source,
    },
  });

  res.json({ ok: true });
});

loansRouter.delete("/clients/:id", requireAuth, async (req, res) => {
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const result = await pool.query(
    `UPDATE loan_clients
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [params.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.client.delete",
    targetType: "loan_client",
    targetId: params.id,
  });

  res.status(204).send();
});

loansRouter.get("/clients/:id/interactions", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const result = await pool.query(
    `SELECT
      i.id,
      i.client_id AS "clientId",
      i.notes,
      i.channel,
      i.scheduled_for AS "scheduledFor",
      i.completed_at AS "completedAt",
      i.created_at AS "createdAt",
      u.name AS "userName"
    FROM loan_interactions i
    LEFT JOIN users u ON u.id = i.user_id
    WHERE i.client_id = $1
    ORDER BY i.created_at DESC`,
    [params.id],
  );
  res.json(result.rows);
});

loansRouter.post("/clients/:id/interactions", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = interactionSchema.parse(req.body);

  const clientExists = await pool.query(
    `SELECT id FROM loan_clients WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [params.id],
  );
  if (!clientExists.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  const created = await pool.query(
    `INSERT INTO loan_interactions (client_id, user_id, channel, notes, scheduled_for)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING
       id,
       client_id AS "clientId",
       notes,
       channel,
       scheduled_for AS "scheduledFor",
       completed_at AS "completedAt",
       created_at AS "createdAt"`,
    [params.id, user.id, payload.channel, payload.notes, payload.scheduledFor ?? null],
  );
  await pool.query(
    `UPDATE loan_clients SET last_contact_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [params.id],
  );

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.interaction.create",
    targetType: "loan_client",
    targetId: params.id,
    details: { channel: payload.channel },
  });

  res.status(201).json(created.rows[0]);
});

loansRouter.get("/clients/:id/simulations", requireAuth, async (req, res) => {
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const result = await pool.query(
    `SELECT
      s.id,
      s.client_id AS "clientId",
      s.product_id AS "productId",
      s.product_type AS "productType",
      s.principal,
      s.installments,
      s.monthly_rate AS "monthlyRate",
      s.installment_value AS "installmentValue",
      s.total_paid AS "totalPaid",
      s.effective_cost AS "effectiveCost",
      s.is_best AS "isBest",
      s.created_at AS "createdAt"
    FROM loan_simulations s
    WHERE s.client_id = $1
    ORDER BY s.created_at DESC`,
    [params.id],
  );
  res.json(result.rows);
});

loansRouter.post("/clients/:id/simulations", requireAuth, async (req, res) => {
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = simulationSchema.parse(req.body);
  const installmentValue = pmt(payload.principal, payload.monthlyRate, payload.installments);
  const totalPaid = installmentValue * payload.installments;
  const effectiveCost = totalPaid - payload.principal;

  const created = await pool.query(
    `INSERT INTO loan_simulations (
      client_id,
      product_id,
      product_type,
      principal,
      installments,
      monthly_rate,
      installment_value,
      total_paid,
      effective_cost,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING
      id,
      client_id AS "clientId",
      product_id AS "productId",
      product_type AS "productType",
      principal,
      installments,
      monthly_rate AS "monthlyRate",
      installment_value AS "installmentValue",
      total_paid AS "totalPaid",
      effective_cost AS "effectiveCost",
      is_best AS "isBest",
      created_at AS "createdAt"`,
    [
      params.id,
      payload.productId ?? null,
      payload.productType,
      payload.principal,
      payload.installments,
      payload.monthlyRate,
      installmentValue,
      totalPaid,
      effectiveCost,
      user.id,
    ],
  );

  await pool.query(
    `WITH ranked AS (
      SELECT id
      FROM loan_simulations
      WHERE client_id = $1
      ORDER BY total_paid ASC, created_at DESC
      LIMIT 1
    )
    UPDATE loan_simulations
    SET is_best = (id IN (SELECT id FROM ranked))
    WHERE client_id = $1`,
    [params.id],
  );
  await pool.query(
    `UPDATE loan_clients SET last_contact_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [params.id],
  );

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.simulation.create",
    targetType: "loan_client",
    targetId: params.id,
    details: {
      principal: payload.principal,
      installments: payload.installments,
      monthlyRate: payload.monthlyRate,
    },
  });

  res.status(201).json(created.rows[0]);
});

loansRouter.post("/clients/:id/activity-touch", requireAuth, async (req, res) => {
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = z
    .object({
      channel: z.enum(["whatsapp", "simulation"]),
    })
    .parse(req.body);

  const clientResult = await pool.query<{ id: number }>(
    `UPDATE loan_clients
     SET last_contact_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [params.id],
  );
  if (!clientResult.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.client.activity_touch",
    targetType: "loan_client",
    targetId: params.id,
    details: { channel: payload.channel },
  });

  res.status(204).send();
});

loansRouter.get("/products", requireAuth, async (_req, res) => {
  const result = await pool.query(
    `SELECT
      id,
      name,
      product_type AS "productType",
      default_rate AS "defaultRate",
      min_term AS "minTerm",
      max_term AS "maxTerm",
      active,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM loan_products
    ORDER BY active DESC, name ASC`,
  );
  res.json(result.rows);
});

loansRouter.post("/products", requireAuth, requireRole("admin"), async (req, res) => {
  const user = req.user!;
  const payload = productSchema.parse(req.body);
  if (payload.maxTerm < payload.minTerm) {
    res.status(400).json({ message: "Prazo maximo deve ser maior ou igual ao minimo." });
    return;
  }

  const created = await pool.query(
    `INSERT INTO loan_products (name, product_type, default_rate, min_term, max_term, active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      payload.name,
      payload.productType,
      payload.defaultRate,
      payload.minTerm,
      payload.maxTerm,
      payload.active,
    ],
  );

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.product.create",
    targetType: "loan_product",
    targetId: Number(created.rows[0].id),
    details: { name: payload.name, productType: payload.productType },
  });

  res.status(201).json({ id: Number(created.rows[0].id) });
});

loansRouter.post("/imports", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const payload = importSchema.parse(req.body);

  const normalized = payload.leads.map((lead, index) => {
    try {
      return {
        ...lead,
        cpf: normalizeCpf(lead.cpf),
        phones: Array.from(new Set(lead.phones.map(normalizePhone))),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Dados invalidos para importacao.";
      throw new Error(`Erro na linha ${index + 2} da planilha: ${reason}`);
    }
  });

  const uniqueLeads: typeof normalized = [];
  const seenCpf = new Set<string>();
  const seenPhone = new Set<string>();
  let duplicatesInFile = 0;

  for (const lead of normalized) {
    const duplicatedByCpf = seenCpf.has(lead.cpf);
    const duplicatedByPhone = lead.phones.some((phone) => seenPhone.has(phone));
    if (duplicatedByCpf || duplicatedByPhone) {
      duplicatesInFile += 1;
      continue;
    }
    seenCpf.add(lead.cpf);
    lead.phones.forEach((phone) => seenPhone.add(phone));
    uniqueLeads.push(lead);
  }

  const existingCpfResult = await pool.query(
    `SELECT cpf FROM loan_clients WHERE deleted_at IS NULL AND cpf = ANY($1::text[])`,
    [Array.from(seenCpf)],
  );
  const existingCpf = new Set(existingCpfResult.rows.map((row) => String(row.cpf)));
  const existingPhoneResult = await pool.query(
    `SELECT p.phone
     FROM loan_client_phones p
     JOIN loan_clients c ON c.id = p.client_id
     WHERE c.deleted_at IS NULL AND p.phone = ANY($1::text[])`,
    [Array.from(seenPhone)],
  );
  const existingPhones = new Set(existingPhoneResult.rows.map((row) => String(row.phone)));

  let importedRows = 0;
  let duplicateRows = duplicatesInFile;

  for (const lead of uniqueLeads) {
    if (existingCpf.has(lead.cpf) || lead.phones.some((phone) => existingPhones.has(phone))) {
      duplicateRows += 1;
      continue;
    }

    const createdClient = await pool.query(
      `INSERT INTO loan_clients (
        name, cpf, city, profession, convenio, income, status, source, assigned_user_id, created_by, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING id`,
      [
        lead.name,
        lead.cpf,
        lead.city,
        lead.profession,
        lead.convenio,
        lead.income,
        lead.status,
        payload.source,
        user.id,
        user.id,
      ],
    );
    const clientId = Number(createdClient.rows[0].id);
    for (const phone of lead.phones) {
      await pool.query(`INSERT INTO loan_client_phones (client_id, phone) VALUES ($1, $2)`, [
        clientId,
        phone,
      ]);
    }
    importedRows += 1;
  }

  await pool.query(
    `INSERT INTO loan_imports (source, imported_by, total_rows, imported_rows, duplicate_rows)
     VALUES ($1, $2, $3, $4, $5)`,
    [payload.source, user.id, payload.leads.length, importedRows, duplicateRows],
  );

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.import.create",
    targetType: "loan_import",
    targetId: null,
    details: {
      source: payload.source,
      totalRows: payload.leads.length,
      importedRows,
      duplicateRows,
    },
  });

  res.status(201).json({
    totalRows: payload.leads.length,
    importedRows,
    duplicateRows,
  });
});

loansRouter.get("/settings", requireAuth, async (_req, res) => {
  await ensureLoanSettingsTable();
  const result = await pool.query<{ key: string; value_text: string }>(
    `SELECT key, value_text
     FROM loan_settings
     WHERE key IN ('consignable_margin_percent', 'consignado_rate', 'pessoal_rate')`,
  );
  const map = new Map(result.rows.map((row) => [row.key, row.value_text]));
  const consignableMarginPercent = Number(map.get("consignable_margin_percent") ?? "30");
  const consignadoRate = Number(map.get("consignado_rate") ?? "1.8");
  const pessoalRate = Number(map.get("pessoal_rate") ?? "3.5");
  res.json({
    consignableMarginPercent:
      Number.isFinite(consignableMarginPercent) && consignableMarginPercent > 0
        ? consignableMarginPercent
        : 30,
    consignadoRate: Number.isFinite(consignadoRate) && consignadoRate > 0 ? consignadoRate : 1.8,
    pessoalRate: Number.isFinite(pessoalRate) && pessoalRate > 0 ? pessoalRate : 3.5,
  });
});

loansRouter.put("/settings", requireAuth, requireRole("admin"), async (req, res) => {
  await ensureLoanSettingsTable();
  const user = req.user!;
  const payload = settingsSchema.parse(req.body);
  if (payload.consignableMarginPercent !== undefined) {
    await pool.query(
      `INSERT INTO loan_settings (key, value_text, updated_by, updated_at)
       VALUES ('consignable_margin_percent', $1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value_text = EXCLUDED.value_text, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [String(payload.consignableMarginPercent), user.id],
    );
  }
  if (payload.consignadoRate !== undefined) {
    await pool.query(
      `INSERT INTO loan_settings (key, value_text, updated_by, updated_at)
       VALUES ('consignado_rate', $1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value_text = EXCLUDED.value_text, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [String(payload.consignadoRate), user.id],
    );
  }
  if (payload.pessoalRate !== undefined) {
    await pool.query(
      `INSERT INTO loan_settings (key, value_text, updated_by, updated_at)
       VALUES ('pessoal_rate', $1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value_text = EXCLUDED.value_text, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [String(payload.pessoalRate), user.id],
    );
  }
  const current = await pool.query<{ key: string; value_text: string }>(
    `SELECT key, value_text
     FROM loan_settings
     WHERE key IN ('consignable_margin_percent', 'consignado_rate', 'pessoal_rate')`,
  );
  const map = new Map(current.rows.map((row) => [row.key, row.value_text]));
  res.json({
    consignableMarginPercent: Number(map.get("consignable_margin_percent") ?? "30"),
    consignadoRate: Number(map.get("consignado_rate") ?? "1.8"),
    pessoalRate: Number(map.get("pessoal_rate") ?? "3.5"),
  });
});

export { loansRouter };
