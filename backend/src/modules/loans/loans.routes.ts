import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { createAuditLog } from "../audit/audit.service";

const DEFAULT_PIPELINE_STAGES = [
  { key: "novo", label: "Novo", position: 10, active: true },
  { key: "em_atendimento", label: "Em atendimento", position: 20, active: true },
  { key: "simulacao", label: "Simulação", position: 30, active: true },
  { key: "em_analise", label: "Em analise", position: 40, active: true },
  { key: "digitacao", label: "Digitacao", position: 50, active: true },
  { key: "seguro_ap", label: "Seguro AP", position: 60, active: true },
  { key: "assinatura", label: "Assinatura", position: 70, active: true },
  { key: "pagamento", label: "Pagamento", position: 80, active: true },
  { key: "ganho", label: "Ganho", position: 90, active: true },
  { key: "perdido", label: "Perdido", position: 100, active: true },
] as const;

const productTypeValues = ["credito", "seguros", "capitalizacao", "imobiliario"] as const;

type PipelineStage = {
  key: string;
  label: string;
  position: number;
  active: boolean;
};

const TERMINAL_STATUS_KEYS = new Set(["ganho", "perdido"]);

type LossSnapshot = {
  reason: string | null;
  hasMargin: boolean | null;
};

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
  status: z.string().trim().min(1).default("novo"),
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

function buildLossNote(reason: string, hasMargin: boolean): string {
  return `Motivo da perda: ${reason.trim()} | Possui margem: ${hasMargin ? "Sim" : "Não"}`;
}

function slugifyStageKey(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `etapa_${Date.now()}`;
}

function normalizePipelineStages(raw: unknown): PipelineStage[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_PIPELINE_STAGES.map((item) => ({ ...item }));
  }
  const normalized = raw
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const key = typeof source.key === "string" ? source.key.trim() : "";
      const label = typeof source.label === "string" ? source.label.trim() : "";
      if (!key || !label) return null;
      const position = Number.isFinite(Number(source.position)) ? Number(source.position) : (index + 1) * 10;
      return {
        key,
        label,
        position,
        active: source.active === undefined ? true : Boolean(source.active),
      } satisfies PipelineStage;
    })
    .filter((item): item is PipelineStage => Boolean(item));

  if (normalized.length === 0) {
    return DEFAULT_PIPELINE_STAGES.map((item) => ({ ...item }));
  }

  const byKey = new Map<string, PipelineStage>();
  for (const item of normalized) {
    if (!byKey.has(item.key)) {
      byKey.set(item.key, item);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, "pt-BR"));
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
  await pool.query(
    `INSERT INTO loan_settings (key, value_text)
     VALUES ('pipeline_stages', $1)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(DEFAULT_PIPELINE_STAGES)],
  );
}

async function getPipelineStages(): Promise<PipelineStage[]> {
  await ensureLoanSettingsTable();
  const result = await pool.query<{ value_text: string }>(
    `SELECT value_text
     FROM loan_settings
     WHERE key = 'pipeline_stages'
     LIMIT 1`,
  );
  let parsed: unknown = null;
  if (result.rows[0]?.value_text) {
    try {
      parsed = JSON.parse(result.rows[0].value_text);
    } catch {
      parsed = null;
    }
  }
  return normalizePipelineStages(parsed);
}

async function savePipelineStages(stages: PipelineStage[], actorUserId?: number): Promise<void> {
  const normalized = normalizePipelineStages(stages).map((item, index) => ({
    ...item,
    position: (index + 1) * 10,
  }));
  await pool.query(
    `INSERT INTO loan_settings (key, value_text, updated_by, updated_at)
     VALUES ('pipeline_stages', $1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value_text = EXCLUDED.value_text, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(normalized), actorUserId ?? null],
  );
}

async function ensureStatusAllowed(status: string, options?: { activeOnly?: boolean }): Promise<void> {
  const stages = await getPipelineStages();
  const allowed = stages.filter((stage) => (options?.activeOnly === false ? true : stage.active));
  if (!allowed.some((stage) => stage.key === status)) {
    throw new Error("Status de funil inválido para a configuração atual.");
  }
}

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUS_KEYS.has(status);
}

function statusToOutcome(status: string): "ganho" | "perdido" | null {
  if (status === "ganho" || status === "perdido") return status;
  return null;
}

function formatStatusLabel(status: string): string {
  const normalized = status.replace(/_/g, " ").trim();
  if (!normalized) return "-";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function outcomeFromStatus(status: string, stages: PipelineStage[]): "ganho" | "perdido" | null {
  if (TERMINAL_STATUS_KEYS.has(status)) {
    return status as "ganho" | "perdido";
  }
  const stage = stages.find((item) => item.key === status);
  if (!stage) return null;
  const label = normalizeToken(stage.label);
  if (label.includes("ganho")) return "ganho";
  if (label.includes("perdido") || label.includes("perda")) return "perdido";
  return null;
}

function getChannelLabel(channel: string): string {
  const normalized = (channel ?? "").trim().toLowerCase();
  if (normalized === "whatsapp") return "WhatsApp";
  if (normalized === "telefone" || normalized === "phone") return "Telefone";
  if (normalized === "presencial") return "Presencial";
  if (normalized === "email") return "E-mail";
  if (normalized === "simulation") return "Simulação";
  return channel || "Manual";
}

function toDetailsObject(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  return details as Record<string, unknown>;
}

function describeLoanAuditEvent(action: string, details: Record<string, unknown>): { title: string; description: string | null } {
  switch (action) {
    case "loan.client.create":
      return { title: "Cliente criado no funil", description: null };
    case "loan.client.update": {
      const status = typeof details.status === "string" ? formatStatusLabel(details.status) : null;
      const source = typeof details.source === "string" ? details.source : null;
      return {
        title: "Dados do cliente atualizados",
        description: [status ? `Status: ${status}` : null, source ? `Origem: ${source}` : null]
          .filter(Boolean)
          .join(" | ") || null,
      };
    }
    case "loan.client.status": {
      const status = typeof details.status === "string" ? formatStatusLabel(details.status) : "-";
      return { title: "Status alterado", description: `Novo status: ${status}` };
    }
    case "loan.client.heat_badge": {
      const heatBadgeRaw = details.heatBadge;
      const heatBadge = heatBadgeRaw === null ? "Automático" : typeof heatBadgeRaw === "string" ? heatBadgeRaw : "-";
      return { title: "Badge térmico atualizado", description: `Novo badge: ${heatBadge}` };
    }
    case "loan.client.activity_touch": {
      const channel = typeof details.channel === "string" ? getChannelLabel(details.channel) : "Manual";
      return { title: "Toque de atividade registrado", description: `Canal: ${channel}` };
    }
    case "loan.agenda.complete":
      return { title: "Agendamento concluído", description: null };
    case "loan.agenda.reschedule": {
      const scheduledFor =
        typeof details.scheduledFor === "string" ? new Date(details.scheduledFor).toLocaleString("pt-BR") : null;
      return {
        title: "Agendamento reagendado",
        description: scheduledFor ? `Nova data: ${scheduledFor}` : null,
      };
    }
    case "loan.simulation.create": {
      const principal = Number(details.principal ?? 0);
      const installments = Number(details.installments ?? 0);
      return {
        title: "Simulação criada",
        description:
          principal > 0 && installments > 0 ? `Valor: R$ ${principal.toFixed(2)} | Parcelas: ${installments}` : null,
      };
    }
    case "loan.client.loss_margin.update": {
      const hasMargin = details.hasMargin === true ? "Sim" : details.hasMargin === false ? "Não" : "-";
      return { title: "Margem da perda atualizada", description: `Possui margem: ${hasMargin}` };
    }
    case "loan.client.delete":
      return { title: "Cliente excluído", description: null };
    default:
      return { title: action, description: null };
  }
}

async function getLatestLossSnapshot(clientId: number): Promise<LossSnapshot> {
  const latestLoss = await pool.query<{ notes: string }>(
    `SELECT notes
     FROM loan_interactions
     WHERE client_id = $1
       AND notes ILIKE 'Motivo da perda:%'
     ORDER BY created_at DESC
     LIMIT 1`,
    [clientId],
  );
  const parsed = parseLossNote(latestLoss.rows[0]?.notes ?? null);
  return { reason: parsed.reason, hasMargin: parsed.hasMargin };
}

async function ensureLoanOpportunityStructures(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS loan_opportunities (
      id SERIAL PRIMARY KEY,
      client_id INT NOT NULL REFERENCES loan_clients(id) ON DELETE CASCADE,
      cycle_number INT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      assigned_user_id INT REFERENCES users(id),
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      outcome TEXT CHECK (outcome IN ('ganho', 'perdido')),
      loss_reason TEXT,
      loss_has_margin BOOLEAN,
      created_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, cycle_number)
    )`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_loan_opportunities_client ON loan_opportunities(client_id)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_loan_opportunities_status ON loan_opportunities(status)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_loan_opportunities_closed_at ON loan_opportunities(closed_at)`,
  );
}

async function ensureBackfilledLoanOpportunities(): Promise<void> {
  const missingClients = await pool.query<{
    id: number;
    status: string;
    source: string;
    assigned_user_id: number | null;
    created_by: number | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT c.id, c.status, c.source, c.assigned_user_id, c.created_by, c.created_at, c.updated_at
     FROM loan_clients c
     WHERE c.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM loan_opportunities o
         WHERE o.client_id = c.id
       )
     ORDER BY c.id ASC`,
  );

  for (const client of missingClients.rows) {
    const isTerminal = isTerminalStatus(client.status);
    const lossSnapshot = client.status === "perdido" ? await getLatestLossSnapshot(client.id) : null;
    await pool.query(
      `INSERT INTO loan_opportunities (
        client_id,
        cycle_number,
        status,
        source,
        assigned_user_id,
        opened_at,
        closed_at,
        outcome,
        loss_reason,
        loss_has_margin,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (client_id, cycle_number) DO NOTHING`,
      [
        client.id,
        client.status,
        client.source ?? "",
        client.assigned_user_id,
        client.created_at,
        isTerminal ? client.updated_at : null,
        statusToOutcome(client.status),
        lossSnapshot?.reason ?? null,
        lossSnapshot?.hasMargin ?? null,
        client.created_by,
        client.created_at,
      ],
    );
  }
}

async function appendLoanOpportunityCycle(params: {
  clientId: number;
  status: string;
  source: string;
  assignedUserId: number | null;
  actorUserId: number | null;
}): Promise<void> {
  const cycleQuery = await pool.query<{ next_cycle: number }>(
    `SELECT COALESCE(MAX(cycle_number), 0) + 1 AS next_cycle
     FROM loan_opportunities
     WHERE client_id = $1`,
    [params.clientId],
  );
  const nextCycle = Number(cycleQuery.rows[0]?.next_cycle ?? 1);
  await pool.query(
    `INSERT INTO loan_opportunities (
      client_id,
      cycle_number,
      status,
      source,
      assigned_user_id,
      opened_at,
      closed_at,
      outcome,
      created_by,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, NOW(), NULL, NULL, $6, NOW(), NOW())`,
    [params.clientId, nextCycle, params.status, params.source, params.assignedUserId, params.actorUserId],
  );
}

async function syncOpportunityForStatusChange(params: {
  clientId: number;
  previousStatus: string;
  nextStatus: string;
  source: string;
  assignedUserId: number | null;
  actorUserId: number | null;
}): Promise<void> {
  const stages = await getPipelineStages();
  const previousOutcome = outcomeFromStatus(params.previousStatus, stages);
  const nextOutcome = outcomeFromStatus(params.nextStatus, stages);
  const previousIsTerminal = previousOutcome !== null;
  const nextIsTerminal = nextOutcome !== null;
  const movingToNewCycle = previousIsTerminal && !nextIsTerminal;
  if (movingToNewCycle) {
    await appendLoanOpportunityCycle({
      clientId: params.clientId,
      status: params.nextStatus,
      source: params.source,
      assignedUserId: params.assignedUserId,
      actorUserId: params.actorUserId,
    });
    return;
  }

  const openOpportunity = await pool.query<{ id: number }>(
    `SELECT id
     FROM loan_opportunities
     WHERE client_id = $1
       AND closed_at IS NULL
     ORDER BY cycle_number DESC
     LIMIT 1`,
    [params.clientId],
  );

  if (!openOpportunity.rows[0]) {
    await appendLoanOpportunityCycle({
      clientId: params.clientId,
      status: params.nextStatus,
      source: params.source,
      assignedUserId: params.assignedUserId,
      actorUserId: params.actorUserId,
    });
    return;
  }

  let lossSnapshot: LossSnapshot | null = null;
  if (nextOutcome === "perdido") {
    lossSnapshot = await getLatestLossSnapshot(params.clientId);
  }

  await pool.query(
    `UPDATE loan_opportunities
     SET
      status = $2,
      source = $3,
      assigned_user_id = $4,
      closed_at = CASE WHEN $5::boolean THEN NOW() ELSE NULL END,
      outcome = CASE WHEN $5::boolean THEN $6::text ELSE NULL END,
      loss_reason = CASE WHEN $6::text = 'perdido' THEN $7::text ELSE NULL::text END,
      loss_has_margin = CASE WHEN $6::text = 'perdido' THEN $8::boolean ELSE NULL::boolean END,
      updated_at = NOW()
     WHERE id = $1`,
    [
      openOpportunity.rows[0].id,
      params.nextStatus,
      params.source,
      params.assignedUserId,
      nextIsTerminal,
      nextOutcome,
      lossSnapshot?.reason ?? null,
      lossSnapshot?.hasMargin ?? null,
    ],
  );
}

async function ensureLoanClientStructures(): Promise<void> {
  if (loanClientStructureEnsured) return;
  await ensureLoanSettingsTable();
  await ensureLoanOpportunityStructures();
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
  await ensureBackfilledLoanOpportunities();
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

loansRouter.get("/pipeline-stages", requireAuth, async (req, res) => {
  const user = req.user!;
  const stages = await getPipelineStages();
  const result = user.role === "admin" ? stages : stages.filter((stage) => stage.active);
  res.json(result);
});

loansRouter.post("/pipeline-stages", requireAuth, requireRole("admin"), async (req, res) => {
  const user = req.user!;
  const payload = z.object({ label: z.string().trim().min(2).max(60) }).parse(req.body);
  const stages = await getPipelineStages();
  const baseKey = slugifyStageKey(payload.label);
  let key = baseKey;
  let suffix = 2;
  while (stages.some((stage) => stage.key === key)) {
    key = `${baseKey}_${suffix}`;
    suffix += 1;
  }
  const nextStages: PipelineStage[] = [
    ...stages,
    {
      key,
      label: payload.label,
      active: true,
      position: (stages.length + 1) * 10,
    },
  ];
  await savePipelineStages(nextStages, user.id);

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.pipeline_stage.create",
    targetType: "loan_pipeline_stage",
    targetId: null,
    details: { key, label: payload.label },
  });

  res.status(201).json({ key, label: payload.label, active: true });
});

loansRouter.put("/pipeline-stages", requireAuth, requireRole("admin"), async (req, res) => {
  const user = req.user!;
  const payload = z
    .object({
      stages: z.array(
        z.object({
          key: z.string().trim().min(1),
          label: z.string().trim().min(2).max(60),
          active: z.boolean(),
        }),
      ),
    })
    .parse(req.body);

  const uniqueKeys = new Set<string>();
  for (const stage of payload.stages) {
    if (uniqueKeys.has(stage.key)) {
      res.status(400).json({ message: "Há chaves de coluna repetidas no funil." });
      return;
    }
    uniqueKeys.add(stage.key);
  }
  if (payload.stages.length === 0) {
    res.status(400).json({ message: "O funil precisa de ao menos uma coluna." });
    return;
  }
  if (!payload.stages.some((stage) => stage.active)) {
    res.status(400).json({ message: "Mantenha ao menos uma coluna ativa no funil." });
    return;
  }

  const nextStages: PipelineStage[] = payload.stages.map((stage, index) => ({
    ...stage,
    position: (index + 1) * 10,
  }));
  await savePipelineStages(nextStages, user.id);

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.pipeline_stage.update",
    targetType: "loan_pipeline_stage",
    targetId: null,
    details: { totalStages: nextStages.length },
  });

  res.json(nextStages);
});

loansRouter.delete("/pipeline-stages/:key", requireAuth, requireRole("admin"), async (req, res) => {
  const user = req.user!;
  const params = z.object({ key: z.string().trim().min(1) }).parse(req.params);
  const stages = await getPipelineStages();
  const target = stages.find((stage) => stage.key === params.key);
  if (!target) {
    res.status(404).json({ message: "Coluna não encontrada." });
    return;
  }
  if (stages.length <= 1) {
    res.status(400).json({ message: "Não é possível excluir a última coluna do funil." });
    return;
  }

  const inUse = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total
     FROM loan_clients
     WHERE deleted_at IS NULL
       AND status = $1`,
    [params.key],
  );
  if (Number(inUse.rows[0]?.total ?? 0) > 0) {
    res.status(400).json({ message: "Não é possível excluir esta coluna porque ela possui clientes." });
    return;
  }

  const nextStages = stages.filter((stage) => stage.key !== params.key);
  await savePipelineStages(nextStages, user.id);

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.pipeline_stage.delete",
    targetType: "loan_pipeline_stage",
    targetId: null,
    details: { key: params.key, label: target.label },
  });

  res.status(204).send();
});

loansRouter.get("/reports/funnel-outcomes", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const query = z
    .object({
      monthRef: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    })
    .parse(req.query);
  const params: Array<string> = [];
  let scope = "c.deleted_at IS NULL AND o.outcome IN ('ganho', 'perdido')";
  if (query.monthRef) {
    params.push(`${query.monthRef}-01`);
    scope += ` AND DATE_TRUNC('month', o.closed_at) = DATE_TRUNC('month', $${params.length}::date)`;
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
    lostReason: string | null;
    lostHasMargin: boolean | null;
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
      o.outcome AS status,
      u.name AS "assignedUserName",
      COALESCE(o.closed_at, o.updated_at) AS "updatedAt",
      o.closed_at AS "lastLossInteractionAt",
      o.loss_reason AS "lostReason",
      o.loss_has_margin AS "lostHasMargin",
      COALESCE(phones.phones, ARRAY[]::text[]) AS phones
    FROM loan_opportunities o
    JOIN loan_clients c ON c.id = o.client_id
    LEFT JOIN users u ON u.id = o.assigned_user_id
    LEFT JOIN LATERAL (
      SELECT ARRAY_AGG(p.phone ORDER BY p.id) AS phones
      FROM loan_client_phones p
      WHERE p.client_id = c.id
    ) phones ON TRUE
    WHERE ${scope}
    ORDER BY COALESCE(o.closed_at, o.updated_at) DESC, o.id DESC`,
    params,
  );

  const items = result.rows.map((row) => {
    const fallbackLoss =
      row.status === "perdido" && row.lostReason === null && row.lostHasMargin === null
        ? parseLossNote(null)
        : { reason: row.lostReason, hasMargin: row.lostHasMargin };
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
      lostReason: row.status === "perdido" ? fallbackLoss.reason : null,
      lostHasMargin: row.status === "perdido" ? fallbackLoss.hasMargin : null,
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

loansRouter.patch("/clients/:id/loss-margin", requireAuth, requireRole("admin"), async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const payload = z.object({ hasMargin: z.boolean() }).parse(req.body);

  const clientResult = await pool.query<{ id: number; status: string }>(
    `SELECT id, status
     FROM loan_clients
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [params.id],
  );

  if (!clientResult.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  if (clientResult.rows[0].status !== "perdido") {
    res.status(400).json({ message: "A margem da perda só pode ser alterada para clientes perdidos." });
    return;
  }

  const latestLoss = await pool.query<{ id: number; notes: string; created_at: string }>(
    `SELECT id, notes, created_at
     FROM loan_interactions
     WHERE client_id = $1
       AND notes ILIKE 'Motivo da perda:%'
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.id],
  );

  const existingReason = parseLossNote(latestLoss.rows[0]?.notes ?? null).reason ?? "Sem motivo informado.";
  const nextNote = buildLossNote(existingReason, payload.hasMargin);

  if (latestLoss.rows[0]) {
    await pool.query(
      `UPDATE loan_interactions
       SET notes = $1
       WHERE id = $2`,
      [nextNote, latestLoss.rows[0].id],
    );
  } else {
    await pool.query(
      `INSERT INTO loan_interactions (client_id, user_id, channel, notes, scheduled_for, completed_at)
       VALUES ($1, $2, $3, $4, NULL, NOW())`,
      [params.id, user.id, "presencial", nextNote],
    );
  }

  await pool.query(
    `UPDATE loan_opportunities
     SET
      loss_has_margin = $2,
      loss_reason = COALESCE(loss_reason, $3),
      updated_at = NOW()
     WHERE id = (
       SELECT id
       FROM loan_opportunities
       WHERE client_id = $1
         AND outcome = 'perdido'
       ORDER BY cycle_number DESC
       LIMIT 1
     )`,
    [params.id, payload.hasMargin, existingReason],
  );

  await createAuditLog({
    actorUserId: user.id,
    action: "loan.client.loss_margin.update",
    targetType: "loan_client",
    targetId: params.id,
    details: {
      hasMargin: payload.hasMargin,
      note: nextNote,
    },
  });

  res.json({
    ok: true,
    hasMargin: payload.hasMargin,
    note: nextNote,
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
      status: z.string().trim().min(1).optional(),
      source: z.string().trim().optional(),
      convenio: z.string().trim().optional(),
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
  if (query.convenio) {
    params.push(query.convenio);
    scope += ` AND c.convenio = $${params.length}`;
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

loansRouter.get("/clients/:id/opportunities", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const clientExists = await pool.query<{ id: number }>(
    `SELECT id
     FROM loan_clients
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [params.id],
  );
  if (!clientExists.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  const result = await pool.query<{
    id: number;
    cycleNumber: number;
    status: string;
    source: string;
    assignedUserId: number | null;
    assignedUserName: string | null;
    openedAt: string;
    closedAt: string | null;
    outcome: "ganho" | "perdido" | null;
    lossReason: string | null;
    lossHasMargin: boolean | null;
    createdAt: string;
    updatedAt: string;
  }>(
    `SELECT
      o.id,
      o.cycle_number AS "cycleNumber",
      o.status,
      o.source,
      o.assigned_user_id AS "assignedUserId",
      u.name AS "assignedUserName",
      o.opened_at AS "openedAt",
      o.closed_at AS "closedAt",
      o.outcome,
      o.loss_reason AS "lossReason",
      o.loss_has_margin AS "lossHasMargin",
      o.created_at AS "createdAt",
      o.updated_at AS "updatedAt"
    FROM loan_opportunities o
    LEFT JOIN users u ON u.id = o.assigned_user_id
    WHERE o.client_id = $1
    ORDER BY o.cycle_number DESC, o.id DESC`,
    [params.id],
  );

  res.json(result.rows);
});

loansRouter.get("/clients/:id/timeline", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const clientExists = await pool.query<{ id: number }>(
    `SELECT id
     FROM loan_clients
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [params.id],
  );
  if (!clientExists.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  const [interactionsResult, auditResult] = await Promise.all([
    pool.query<{
      id: number;
      notes: string;
      channel: string;
      scheduledFor: string | null;
      completedAt: string | null;
      createdAt: string;
      actorUserName: string | null;
    }>(
      `SELECT
        i.id,
        i.notes,
        i.channel,
        i.scheduled_for AS "scheduledFor",
        i.completed_at AS "completedAt",
        i.created_at AS "createdAt",
        u.name AS "actorUserName"
      FROM loan_interactions i
      LEFT JOIN users u ON u.id = i.user_id
      WHERE i.client_id = $1
      ORDER BY i.created_at DESC
      LIMIT 300`,
      [params.id],
    ),
    pool.query<{
      id: number;
      action: string;
      details: unknown;
      createdAt: string;
      actorUserName: string | null;
    }>(
      `SELECT
        a.id,
        a.action,
        a.details,
        a.created_at AS "createdAt",
        u.name AS "actorUserName"
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.target_type = 'loan_client'
        AND a.target_id = $1
        AND a.action <> 'loan.interaction.create'
      ORDER BY a.created_at DESC
      LIMIT 300`,
      [params.id],
    ),
  ]);

  const interactionItems = interactionsResult.rows.map((item) => ({
    id: `interaction-${item.id}`,
    kind: "interaction" as const,
    title: `Atividade (${getChannelLabel(item.channel)})`,
    description: item.notes,
    actorUserName: item.actorUserName,
    createdAt: item.createdAt,
    scheduledFor: item.scheduledFor,
    completedAt: item.completedAt,
  }));

  const auditItems = auditResult.rows.map((item) => {
    const details = toDetailsObject(item.details);
    const described = describeLoanAuditEvent(item.action, details);
    return {
      id: `audit-${item.id}`,
      kind: "event" as const,
      action: item.action,
      title: described.title,
      description: described.description,
      actorUserName: item.actorUserName,
      createdAt: item.createdAt,
      scheduledFor: null,
      completedAt: null,
    };
  });

  const items = [...interactionItems, ...auditItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  res.json(items);
});

loansRouter.post("/clients", requireAuth, async (req, res) => {
  await ensureLoanClientStructures();
  const user = req.user!;
  const payload = clientSchema.parse(req.body);
  try {
    await ensureStatusAllowed(payload.status);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Status inválido." });
    return;
  }
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
  await appendLoanOpportunityCycle({
    clientId,
    status: payload.status,
    source: payload.source,
    assignedUserId,
    actorUserId: user.id,
  });
  if (isTerminalStatus(payload.status)) {
    await syncOpportunityForStatusChange({
      clientId,
      previousStatus: payload.status,
      nextStatus: payload.status,
      source: payload.source,
      assignedUserId,
      actorUserId: user.id,
    });
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
  const payload = z.object({ status: z.string().trim().min(1) }).parse(req.body);
  try {
    await ensureStatusAllowed(payload.status);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Status inválido." });
    return;
  }

  const previousClient = await pool.query<{ id: number; status: string; source: string; assigned_user_id: number | null }>(
    `SELECT id, status, source, assigned_user_id
     FROM loan_clients
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [params.id],
  );
  if (!previousClient.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  const result = await pool.query(
    `UPDATE loan_clients
     SET status = $1, last_contact_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING id, status, source, assigned_user_id`,
    [payload.status, params.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ message: "Cliente nao encontrado." });
    return;
  }

  await syncOpportunityForStatusChange({
    clientId: params.id,
    previousStatus: previousClient.rows[0].status,
    nextStatus: payload.status,
    source: result.rows[0].source ?? previousClient.rows[0].source ?? "",
    assignedUserId: result.rows[0].assigned_user_id ?? previousClient.rows[0].assigned_user_id ?? null,
    actorUserId: user.id,
  });

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
  try {
    await ensureStatusAllowed(payload.status);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Status inválido." });
    return;
  }
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

  const existingClient = await pool.query<{
    id: number;
    status: string;
    source: string;
    assigned_user_id: number | null;
  }>(
    `SELECT id, status, source, assigned_user_id
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

  const updatedClient = await pool.query<{
    id: number;
    status: string;
    source: string;
    assigned_user_id: number | null;
  }>(
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
     WHERE id = $11
     RETURNING id, status, source, assigned_user_id`,
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
  await syncOpportunityForStatusChange({
    clientId: params.id,
    previousStatus: existingClient.rows[0].status,
    nextStatus: payload.status,
    source: updatedClient.rows[0]?.source ?? payload.source,
    assignedUserId: updatedClient.rows[0]?.assigned_user_id ?? assignedUserId,
    actorUserId: user.id,
  });

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

  if (payload.notes.toLowerCase().includes("motivo da perda:")) {
    const parsed = parseLossNote(payload.notes);
    await pool.query(
      `UPDATE loan_opportunities
       SET
        loss_reason = COALESCE($2, loss_reason),
        loss_has_margin = COALESCE($3, loss_has_margin),
        updated_at = NOW()
       WHERE id = (
         SELECT id
         FROM loan_opportunities
         WHERE client_id = $1
           AND (status = 'perdido' OR outcome = 'perdido')
         ORDER BY cycle_number DESC
         LIMIT 1
       )`,
      [params.id, parsed.reason, parsed.hasMargin],
    );
  }

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
  const allowedStages = new Set((await getPipelineStages()).filter((stage) => stage.active).map((stage) => stage.key));

  const normalized = payload.leads.map((lead, index) => {
    try {
      if (!allowedStages.has(lead.status)) {
        throw new Error(`Status de funil inválido: ${lead.status}`);
      }
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
    await appendLoanOpportunityCycle({
      clientId,
      status: lead.status,
      source: payload.source,
      assignedUserId: user.id,
      actorUserId: user.id,
    });
    if (isTerminalStatus(lead.status)) {
      await syncOpportunityForStatusChange({
        clientId,
        previousStatus: lead.status,
        nextStatus: lead.status,
        source: payload.source,
        assignedUserId: user.id,
        actorUserId: user.id,
      });
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
