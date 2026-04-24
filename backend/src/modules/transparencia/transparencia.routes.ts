import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../../middlewares/auth";
import { createAuditLog } from "../audit/audit.service";
import {
  ensureTransparenciaStructures,
  importarServidores,
  simularServidorImportado,
} from "./transparencia.service";
import { pool } from "../../db/pool";

const importarSchema = z.object({
  ano: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
  nome: z.string().optional(),
  tamanho: z.coerce.number().int().min(1).max(100).default(50),
  maxPaginas: z.coerce.number().int().min(1).max(500).default(10),
});

const transparenciaRouter = Router();
type ImportJobStatus = "running" | "completed" | "failed";
type ImportJob = {
  jobId: string;
  status: ImportJobStatus;
  createdAt: string;
  updatedAt: string;
  processados: number;
  estimadoTotal: number;
  importados: number;
  comConsignado: number;
  semConsignado: number;
  duplicados: number;
  erros: number;
  errorMessage?: string;
};
const importJobs = new Map<string, ImportJob>();

transparenciaRouter.get("/servidores-importados", requireAuth, async (req, res) => {
  await ensureTransparenciaStructures();
  const querySchema = z.object({
    nome: z.string().trim().optional(),
    rubrica: z.string().trim().optional(),
    ano: z.coerce.number().int().min(2000).max(2100).optional(),
    mes: z.coerce.number().int().min(1).max(12).optional(),
    classificacao: z.enum(["Com consignado", "Sem consignado"]).optional(),
    classificacaoMargem: z.enum(["Alta", "Media", "Baixa"]).optional(),
    classificacaoScore: z.enum(["Quente", "Morno", "Frio"]).optional(),
    prioridadeAtendimento: z.enum(["Alta", "Media", "Baixa"]).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(50),
  });
  const query = querySchema.parse(req.query);
  const params: Array<number | string> = [];
  const conditions: string[] = [];

  if (query.nome) {
    params.push(`%${query.nome}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  if (query.rubrica) {
    params.push(`%${query.rubrica}%`);
    conditions.push(`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(raw_detail_payload->'rubricas', '[]'::jsonb)) r
      WHERE TRIM(COALESCE(r->>'nome', r->>'descricao', r->>'rubrica', '')) <> ''
        AND (
          UPPER(TRIM(COALESCE(
            r->>'tipo',
            r->>'natureza',
            r->>'classificacao',
            r->>'tipoRubrica',
            r->>'tipoRendimento',
            r->>'tpRendimento',
            r->>'tpRubrica',
            r->>'descricaoTipo',
            ''
          ))) LIKE '%DESCONTO%'
          OR UPPER(TRIM(COALESCE(
            r->>'tipo',
            r->>'natureza',
            r->>'classificacao',
            r->>'tipoRubrica',
            r->>'tipoRendimento',
            r->>'tpRendimento',
            r->>'tpRubrica',
            r->>'descricaoTipo',
            ''
          ))) LIKE '%DEBIT%'
          OR UPPER(TRIM(COALESCE(
            r->>'tipo',
            r->>'natureza',
            r->>'classificacao',
            r->>'tipoRubrica',
            r->>'tipoRendimento',
            r->>'tpRendimento',
            r->>'tpRubrica',
            r->>'descricaoTipo',
            ''
          ))) IN ('D', 'DESC')
        )
        AND COALESCE(r->>'nome', r->>'descricao', r->>'rubrica', '') ILIKE $${params.length}
    )`);
  }
  if (query.ano) {
    params.push(query.ano);
    conditions.push(`ano = $${params.length}`);
  }
  if (query.mes) {
    params.push(query.mes);
    conditions.push(`mes = $${params.length}`);
  }
  if (query.classificacao) {
    params.push(query.classificacao);
    conditions.push(`classificacao_consignado = $${params.length}`);
  }
  if (query.classificacaoMargem) {
    params.push(query.classificacaoMargem);
    conditions.push(`classificacao_margem = $${params.length}`);
  }
  if (query.classificacaoScore) {
    params.push(query.classificacaoScore);
    conditions.push(`classificacao_score = $${params.length}`);
  }
  if (query.prioridadeAtendimento) {
    params.push(query.prioridadeAtendimento);
    conditions.push(`prioridade_atendimento = $${params.length}`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
    FROM loan_public_servants
    ${whereClause}`,
    params,
  );
  const totalsResult = await pool.query<{ valorBruto: number; valorLiquido: number }>(
    `SELECT
      COALESCE(SUM(valor_bruto), 0)::float8 AS "valorBruto",
      COALESCE(SUM(valor_liquido), 0)::float8 AS "valorLiquido"
    FROM loan_public_servants
    ${whereClause}`,
    params,
  );
  const total = Number(totalResult.rows[0]?.total ?? "0");
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.limit;
  const dataParams = [...params, query.limit, offset];
  const result = await pool.query(
    `SELECT
      id,
      source_external_id AS "sourceExternalId",
      name,
      cargo,
      unidade_gestora AS "unidadeGestora",
      lotacao,
      mes,
      ano,
      valor_liquido AS "valorLiquido",
      valor_bruto AS "valorBruto",
      (
        SELECT COALESCE(SUM(s2.valor_bruto), 0)::float8
        FROM loan_public_servants s2
        WHERE s2.ano = s.ano
          AND s2.mes = s.mes
          AND (
            (COALESCE(BTRIM(s.source_external_id), '') <> '' AND s2.source_external_id = s.source_external_id)
            OR (
              COALESCE(BTRIM(s.source_external_id), '') = ''
              AND LOWER(BTRIM(s2.name)) = LOWER(BTRIM(s.name))
            )
          )
      ) AS "salarioBrutoTotalPeriodo",
      (
        SELECT COALESCE(SUM(s2.valor_liquido), 0)::float8
        FROM loan_public_servants s2
        WHERE s2.ano = s.ano
          AND s2.mes = s.mes
          AND (
            (COALESCE(BTRIM(s.source_external_id), '') <> '' AND s2.source_external_id = s.source_external_id)
            OR (
              COALESCE(BTRIM(s.source_external_id), '') = ''
              AND LOWER(BTRIM(s2.name)) = LOWER(BTRIM(s.name))
            )
          )
      ) AS "salarioLiquidoTotalPeriodo",
      (valor_bruto - valor_liquido) AS descontos,
      data_admissao AS "dataAdmissao",
      regime,
      vinculo,
      margem_maxima AS "margemMaxima",
      margem_utilizada AS "margemUtilizada",
      margem_disponivel AS "margemDisponivel",
      classificacao_margem AS "classificacaoMargem",
      score,
      classificacao_score AS "classificacaoScore",
      classificacao_consignado AS "classificacaoConsignado",
      valor_maximo_liberado AS "valorMaximoLiberado",
      melhor_parcela AS "melhorParcela",
      melhor_prazo AS "melhorPrazo",
      total_pago AS "totalPago",
      produto_recomendado AS "produtoRecomendado",
      motivo_recomendacao AS "motivoRecomendacao",
      prioridade_atendimento AS "prioridadeAtendimento",
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'nome',
              UPPER(TRIM(nome_raw)),
              'valor',
              ABS(
                CASE
                  WHEN TRIM(valor_raw) = '' THEN 0
                  ELSE COALESCE(
                    NULLIF(
                      CASE
                        WHEN POSITION('.' IN valor_raw) > 0 AND POSITION(',' IN valor_raw) > 0
                          THEN REPLACE(REPLACE(REPLACE(REPLACE(valor_raw, 'R$', ''), ' ', ''), '.', ''), ',', '.')
                        WHEN POSITION(',' IN valor_raw) > 0
                          THEN REPLACE(REPLACE(REPLACE(valor_raw, 'R$', ''), ' ', ''), ',', '.')
                        ELSE REPLACE(REPLACE(valor_raw, 'R$', ''), ' ', '')
                      END,
                      ''
                    ),
                    '0'
                  )::numeric
                END
              )
            )
          )
          FROM (
            SELECT
              COALESCE(r->>'nome', r->>'descricao', r->>'rubrica', '') AS nome_raw,
              COALESCE(
                r->>'tipo',
                r->>'natureza',
                r->>'classificacao',
                r->>'tipoRubrica',
                r->>'tipoRendimento',
                r->>'tpRendimento',
                r->>'tpRubrica',
                r->>'descricaoTipo',
                ''
              ) AS tipo_raw,
              COALESCE(
                r->>'valor',
                r->>'valorRubrica',
                r->>'valorDesconto',
                r->>'desconto',
                r->>'valorTotal',
                r->>'total',
                '0'
              ) AS valor_raw
            FROM jsonb_array_elements(COALESCE(raw_detail_payload->'rubricas', '[]'::jsonb)) r
          ) rub
          WHERE
            TRIM(nome_raw) <> ''
            AND (
              UPPER(TRIM(tipo_raw)) LIKE '%DESCONTO%'
              OR UPPER(TRIM(tipo_raw)) LIKE '%DEBIT%'
              OR UPPER(TRIM(tipo_raw)) IN ('D', 'DESC')
            )
        ),
        '[]'::jsonb
      ) AS rubricas,
      imported_at AS "importedAt"
    FROM loan_public_servants s
    ${whereClause}
    ORDER BY imported_at DESC
    LIMIT $${dataParams.length - 1}
    OFFSET $${dataParams.length}`,
    dataParams,
  );

  res.json({
    items: result.rows,
    totals: {
      valorBruto: Number(totalsResult.rows[0]?.valorBruto ?? 0),
      valorLiquido: Number(totalsResult.rows[0]?.valorLiquido ?? 0),
    },
    total,
    page,
    pageSize: query.limit,
    totalPages,
  });
});

transparenciaRouter.get("/servidores-importados/rubricas", requireAuth, async (_req, res) => {
  await ensureTransparenciaStructures();
  const result = await pool.query<{ nome: string; total: number }>(
    `SELECT
      UPPER(TRIM(COALESCE(r->>'nome', r->>'descricao', r->>'rubrica', ''))) AS nome,
      COUNT(*)::int AS total
    FROM loan_public_servants s
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.raw_detail_payload->'rubricas', '[]'::jsonb)) r
    WHERE
      TRIM(COALESCE(r->>'nome', r->>'descricao', r->>'rubrica', '')) <> ''
      AND (
        UPPER(TRIM(COALESCE(
          r->>'tipo',
          r->>'natureza',
          r->>'classificacao',
          r->>'tipoRubrica',
          r->>'tipoRendimento',
          r->>'tpRendimento',
          r->>'tpRubrica',
          r->>'descricaoTipo',
          ''
        ))) LIKE '%DESCONTO%'
        OR UPPER(TRIM(COALESCE(
          r->>'tipo',
          r->>'natureza',
          r->>'classificacao',
          r->>'tipoRubrica',
          r->>'tipoRendimento',
          r->>'tpRendimento',
          r->>'tpRubrica',
          r->>'descricaoTipo',
          ''
        ))) LIKE '%DEBIT%'
        OR UPPER(TRIM(COALESCE(
          r->>'tipo',
          r->>'natureza',
          r->>'classificacao',
          r->>'tipoRubrica',
          r->>'tipoRendimento',
          r->>'tpRendimento',
          r->>'tpRubrica',
          r->>'descricaoTipo',
          ''
        ))) IN ('D', 'DESC')
      )
    GROUP BY 1
    ORDER BY total DESC, nome ASC`,
  );

  res.json({
    items: result.rows,
  });
});

transparenciaRouter.post("/servidores-importados/:id/simular", requireAuth, async (req, res) => {
  await ensureTransparenciaStructures();
  const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const result = await simularServidorImportado({ id: params.id });
  res.json(result);
});

transparenciaRouter.post(
  "/importar-servidores",
  requireAuth,
  async (req, res) => {
    await ensureTransparenciaStructures();
    const user = req.user!;
    const payload = importarSchema.parse(req.body);
    const jobId = randomUUID();
    const now = new Date().toISOString();
    const initial: ImportJob = {
      jobId,
      status: "running",
      createdAt: now,
      updatedAt: now,
      processados: 0,
      estimadoTotal: Math.max(1, (payload.nome?.trim() ? 1 : 5) * payload.maxPaginas * payload.tamanho),
      importados: 0,
      comConsignado: 0,
      semConsignado: 0,
      duplicados: 0,
      erros: 0,
    };
    importJobs.set(jobId, initial);

    void (async () => {
      try {
        const result = await importarServidores({
          ...payload,
          actorUserId: user.id,
          onProgress: (progress) => {
            const current = importJobs.get(jobId);
            if (!current) return;
            importJobs.set(jobId, {
              ...current,
              updatedAt: new Date().toISOString(),
              processados: progress.processados,
              estimadoTotal: progress.estimadoTotal,
              importados: progress.importados,
              duplicados: progress.duplicados,
              erros: progress.erros,
            });
          },
        });

        await createAuditLog({
          actorUserId: user.id,
          action: "loan.public_servants.import",
          targetType: "loan_public_servants",
          targetId: null,
          details: {
            ano: payload.ano,
            mes: payload.mes,
            tamanho: payload.tamanho,
            maxPaginas: payload.maxPaginas,
            ...result,
          },
        });

        const current = importJobs.get(jobId);
        if (!current) return;
        importJobs.set(jobId, {
          ...current,
          status: "completed",
          updatedAt: new Date().toISOString(),
          importados: result.importados,
          comConsignado: result.comConsignado,
          semConsignado: result.semConsignado,
          duplicados: result.duplicados,
          erros: result.erros,
        });
      } catch (error) {
        const current = importJobs.get(jobId);
        if (!current) return;
        importJobs.set(jobId, {
          ...current,
          status: "failed",
          updatedAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : "Falha na importacao.",
        });
      }
    })();

    res.status(202).json({ jobId, status: "running" });
  },
);

transparenciaRouter.get("/importar-servidores/progresso/:jobId", requireAuth, async (req, res) => {
  const params = z.object({ jobId: z.string().min(10) }).parse(req.params);
  const job = importJobs.get(params.jobId);
  if (!job) {
    res.status(404).json({ message: "Importacao nao encontrada." });
    return;
  }
  res.json(job);
});

export { transparenciaRouter };
