import { env } from "../../config/env";
import { pool } from "../../db/pool";

type PortalListPayload = {
  nome: string;
  ano: number;
  mes: number;
  pagina: number;
  tamanho: number;
};

type PortalDetailPayload = {
  codVinculo: string;
  ano: number;
  mes: number;
};

type PublicServantRecord = {
  sourceExternalId: string;
  name: string;
  cargo: string;
  unidadeGestora: string;
  lotacao: string;
  mes: number;
  ano: number;
  valorLiquido: number;
  valorBruto: number;
  dataAdmissao: string;
  regime: string;
  vinculo: string;
  margemMaxima: number;
  margemUtilizada: number;
  margemDisponivel: number;
  classificacaoMargem: "Alta" | "Media" | "Baixa";
  score: number;
  classificacaoScore: "Quente" | "Morno" | "Frio";
  valorMaximoLiberado: number;
  melhorParcela: number;
  melhorPrazo: number;
  totalPago: number;
  produtoRecomendado: string;
  motivoRecomendacao: string;
  prioridadeAtendimento: "Alta" | "Media" | "Baixa";
  classificacaoConsignado: "Com consignado" | "Sem consignado";
  rawListPayload: unknown;
  rawDetailPayload: unknown;
};

const portalTerms = ["CONSIGN", "EMPREST", "BANCO", "PARCELA", "CREDITO"];
const defaultSearchSeeds = ["ana", "mar", "jo", "car", "fer"];
let structureEnsured = false;

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const raw = value.replace(/[R$\s]/g, "").trim();
  if (!raw) return 0;
  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");
  const normalized =
    hasDot && hasComma
      ? raw.replace(/\./g, "").replace(",", ".")
      : hasComma
        ? raw.replace(",", ".")
        : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (env.TRANSPARENCIA_COOKIE) {
    headers.Cookie = env.TRANSPARENCIA_COOKIE;
  }
  if (env.TRANSPARENCIA_HEADERS_JSON) {
    try {
      const parsed = JSON.parse(env.TRANSPARENCIA_HEADERS_JSON) as Record<string, string>;
      Object.assign(headers, parsed);
    } catch {
      // ignore invalid JSON and keep default headers
    }
  }
  return headers;
}

function toAbsolutePath(path: string): string {
  if (path.startsWith("http")) return path;
  return `${env.TRANSPARENCIA_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestPortal(options: {
  path: string;
  query?: Record<string, string | number>;
  timeoutMs?: number;
}): Promise<unknown> {
  const url = new URL(toAbsolutePath(options.path));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: getAuthHeaders(),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const snippet = text.slice(0, 180).replace(/\s+/g, " ");
      throw new Error(
        `Falha no portal (${response.status}) em ${options.path}. Verifique base URL/headers. Resposta: ${snippet}`,
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        `Resposta nao JSON em ${options.path}. Verifique configuracao da API. Trecho: ${text.slice(0, 120)}`,
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractListItems(data: unknown): unknown[] {
  const candidate = data as Record<string, unknown> | undefined;
  if (!candidate) return [];
  if (Array.isArray(candidate.data)) return candidate.data;
  if (Array.isArray(candidate.items)) return candidate.items;
  if (Array.isArray(candidate.registros)) return candidate.registros;
  return [];
}

function extractTotalPages(data: unknown, currentPage: number): number {
  const candidate = data as Record<string, unknown> | undefined;
  if (!candidate) return currentPage;
  const value = Number(candidate.totalPages ?? candidate.total_paginas ?? candidate.paginas);
  if (Number.isFinite(value) && value > 0) return value;
  return currentPage;
}

function normalizeRubricas(detailPayload: unknown): string[] {
  const detail = detailPayload as Record<string, unknown> | undefined;
  if (!detail) return [];
  const rubricas = Array.isArray(detail.rubricas) ? detail.rubricas : [];
  const names: string[] = [];
  for (const row of rubricas) {
    const item = row as Record<string, unknown>;
    const tipo = toText(
      item.tipo ??
        item.natureza ??
        item.classificacao ??
        item.tipoRubrica ??
        item.tipoRendimento ??
        item.tpRendimento ??
        item.tpRubrica ??
        item.descricaoTipo,
    ).toUpperCase();
    const isDesconto =
      tipo.includes("DESCONTO") || tipo.includes("DEBIT") || tipo === "D" || tipo === "DESC";
    if (!isDesconto) continue;
    const text = toText(item.nome ?? item.descricao ?? item.rubrica);
    if (text) names.push(text.toUpperCase());
  }
  return names;
}

type RubricaResumo = {
  nome: string;
  valor: number;
};

type TaxasCredito = {
  consignadoRate: number;
  pessoalRate: number;
};

type SimulacaoCredito = {
  prazo: number;
  taxaMensal: number;
  valorMaximoLiberado: number;
  parcela: number;
  totalPago: number;
  tipo: "Consignado" | "Pessoal";
};

function parseDate(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const ddmmyyyy = text.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractRubricas(detailPayload: unknown): RubricaResumo[] {
  const detail = detailPayload as Record<string, unknown> | undefined;
  if (!detail) return [];
  const rubricas = Array.isArray(detail.rubricas) ? detail.rubricas : [];
  const result: RubricaResumo[] = [];
  for (const row of rubricas) {
    const item = row as Record<string, unknown>;
    const tipo = toText(
      item.tipo ??
        item.natureza ??
        item.classificacao ??
        item.tipoRubrica ??
        item.tipoRendimento ??
        item.tpRendimento ??
        item.tpRubrica ??
        item.descricaoTipo,
    ).toUpperCase();
    const isDesconto =
      tipo.includes("DESCONTO") || tipo.includes("DEBIT") || tipo === "D" || tipo === "DESC";
    if (!isDesconto) continue;
    const nome = toText(item.nome ?? item.descricao ?? item.rubrica).toUpperCase();
    if (!nome) continue;
    const valorRaw =
      item.valor ??
      item.valorRubrica ??
      item.valorDesconto ??
      item.desconto ??
      item.valorTotal ??
      item.total;
    result.push({ nome, valor: Math.abs(toNumber(valorRaw)) });
  }
  return result;
}

function calcularSimulacao(params: {
  margemDisponivel: number;
  taxaMensal: number;
  prazo: number;
  tipo: "Consignado" | "Pessoal";
}): SimulacaoCredito {
  const rate = params.taxaMensal / 100;
  const fator = (1 - (1 + rate) ** -params.prazo) / rate;
  const valorMaximoLiberado = Math.max(0, params.margemDisponivel * fator);
  const parcela = valorMaximoLiberado > 0 ? (valorMaximoLiberado * rate) / (1 - (1 + rate) ** -params.prazo) : 0;
  const totalPago = parcela * params.prazo;
  return {
    prazo: params.prazo,
    taxaMensal: params.taxaMensal,
    valorMaximoLiberado,
    parcela: Math.min(params.margemDisponivel, parcela),
    totalPago,
    tipo: params.tipo,
  };
}

function gerarSimulacoes(params: {
  margemDisponivel: number;
  classificacaoConsignado: "Com consignado" | "Sem consignado";
  taxas: TaxasCredito;
}): {
  simulacoes: SimulacaoCredito[];
  melhor: SimulacaoCredito;
} {
  const prazos = [36, 48, 60, 72];
  const tipos: Array<{ tipo: "Consignado" | "Pessoal"; taxa: number }> = [
    { tipo: "Consignado", taxa: params.taxas.consignadoRate },
    { tipo: "Pessoal", taxa: params.taxas.pessoalRate },
  ];
  const simulacoes = prazos.flatMap((prazo) =>
    tipos.map((tipo) =>
      calcularSimulacao({
        margemDisponivel: params.margemDisponivel,
        taxaMensal: tipo.taxa,
        prazo,
        tipo: tipo.tipo,
      }),
    ),
  );
  const melhor =
    simulacoes.sort((a, b) => b.valorMaximoLiberado - a.valorMaximoLiberado || a.parcela - b.parcela)[0] ??
    calcularSimulacao({
      margemDisponivel: 0,
      taxaMensal: params.taxas.consignadoRate,
      prazo: 36,
      tipo: "Consignado",
    });
  return { simulacoes, melhor };
}

function recomendarProduto(params: {
  regime: string;
  vinculo: string;
  margemDisponivel: number;
  classificacaoConsignado: "Com consignado" | "Sem consignado";
  score: number;
}): {
  produtoRecomendado: string;
  motivo: string;
  prioridade: "Alta" | "Media" | "Baixa";
} {
  const estabilidade = `${params.regime} ${params.vinculo}`.toUpperCase();
  let produtoRecomendado = "Credito Pessoal";
  let motivo = "Regra padrao de oferta.";

  if (estabilidade.includes("ESTATUT") && params.margemDisponivel > 300) {
    produtoRecomendado = "Credito Consignado";
    motivo = "Cliente estavel com margem acima de R$ 300.";
  } else if (params.margemDisponivel < 200) {
    produtoRecomendado = "Refinanciamento";
    motivo = "Margem baixa, foco em reduzir parcela.";
  } else if (params.classificacaoConsignado === "Sem consignado") {
    produtoRecomendado = "Primeiro Consignado";
    motivo = "Cliente sem consignado ativo.";
  }

  const prioridade = params.score >= 80 ? "Alta" : params.score < 50 ? "Baixa" : "Media";
  return { produtoRecomendado, motivo, prioridade };
}

export function classificarConsignado(rubricas: string[]): "Com consignado" | "Sem consignado" {
  const hasConsignado = rubricas.some((rubrica) =>
    portalTerms.some((term) => rubrica.includes(term)),
  );
  return hasConsignado ? "Com consignado" : "Sem consignado";
}

export function calcularScore(params: {
  valorLiquido: number;
  regime: string;
  vinculo: string;
  dataAdmissao: string;
  classificacaoConsignado: "Com consignado" | "Sem consignado";
  classificacaoMargem: "Alta" | "Media" | "Baixa";
}): { score: number; classificacaoScore: "Quente" | "Morno" | "Frio" } {
  let score = 0;
  if (params.valorLiquido > 5000) score += 30;
  else if (params.valorLiquido >= 3000) score += 20;
  else score += 10;

  const estabilidadeText = `${params.regime} ${params.vinculo}`.toUpperCase();
  if (estabilidadeText.includes("ESTATUT")) score += 25;
  else if (estabilidadeText.includes("CLT")) score += 15;
  else score += 5;

  const admissaoDate = parseDate(params.dataAdmissao);
  const serviceYears = admissaoDate
    ? (Date.now() - admissaoDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
    : 0;
  if (serviceYears > 5) score += 20;
  else if (serviceYears >= 2) score += 10;
  else score += 5;

  score += params.classificacaoConsignado === "Sem consignado" ? 15 : 10;

  if (params.classificacaoMargem === "Alta") score += 10;
  else if (params.classificacaoMargem === "Media") score += 5;

  score = Math.max(0, Math.min(100, score));
  const classificacaoScore = score >= 80 ? "Quente" : score >= 50 ? "Morno" : "Frio";
  return { score, classificacaoScore };
}

function calcularMargem(params: {
  valorLiquido: number;
  rubricas: RubricaResumo[];
  margemPercentual: number;
}): {
  margemMaxima: number;
  margemUtilizada: number;
  margemDisponivel: number;
  classificacaoMargem: "Alta" | "Media" | "Baixa";
} {
  const margemMaxima = params.valorLiquido * (params.margemPercentual / 100);
  const margemUtilizada = params.rubricas
    .filter((rubrica) => portalTerms.some((term) => rubrica.nome.includes(term)))
    .reduce((sum, rubrica) => sum + rubrica.valor, 0);
  const margemDisponivel = Math.max(0, margemMaxima - margemUtilizada);
  const classificacaoMargem =
    margemDisponivel > 500 ? "Alta" : margemDisponivel >= 200 ? "Media" : "Baixa";
  return { margemMaxima, margemUtilizada, margemDisponivel, classificacaoMargem };
}

async function obterPercentualMargem(): Promise<number> {
  await ensureTransparenciaStructures();
  const result = await pool.query<{ value_text: string }>(
    `SELECT value_text FROM loan_settings WHERE key = 'consignable_margin_percent' LIMIT 1`,
  );
  const parsed = Number(result.rows[0]?.value_text ?? "30");
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return parsed;
}

async function obterTaxasCredito(): Promise<TaxasCredito> {
  await ensureTransparenciaStructures();
  const result = await pool.query<{ key: string; value_text: string }>(
    `SELECT key, value_text
     FROM loan_settings
     WHERE key IN ('consignado_rate', 'pessoal_rate')`,
  );
  const map = new Map(result.rows.map((row) => [row.key, row.value_text]));
  const consignadoRate = Number(map.get("consignado_rate") ?? "1.8");
  const pessoalRate = Number(map.get("pessoal_rate") ?? "3.5");
  return {
    consignadoRate: Number.isFinite(consignadoRate) && consignadoRate > 0 ? consignadoRate : 1.8,
    pessoalRate: Number.isFinite(pessoalRate) && pessoalRate > 0 ? pessoalRate : 3.5,
  };
}

export async function ensureTransparenciaStructures(): Promise<void> {
  if (structureEnsured) return;
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
    `ALTER TABLE loan_public_servants
      ADD COLUMN IF NOT EXISTS margem_maxima NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS margem_utilizada NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS margem_disponivel NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS classificacao_margem TEXT NOT NULL DEFAULT 'Baixa',
      ADD COLUMN IF NOT EXISTS score INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS classificacao_score TEXT NOT NULL DEFAULT 'Frio',
      ADD COLUMN IF NOT EXISTS valor_maximo_liberado NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS melhor_parcela NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS melhor_prazo INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_pago NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS produto_recomendado TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS motivo_recomendacao TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS prioridade_atendimento TEXT NOT NULL DEFAULT 'Media'`,
  );
  structureEnsured = true;
}

export async function buscarLista(payload: PortalListPayload): Promise<{
  items: unknown[];
  totalPages: number;
}> {
  const data = await requestPortal({
    path: env.TRANSPARENCIA_CONSULTAR_PATH,
    query: {
      nome: payload.nome,
      ano: payload.ano,
      mes: payload.mes,
      page: payload.pagina,
      limit: payload.tamanho,
    },
  });
  return {
    items: extractListItems(data),
    totalPages: extractTotalPages(data, payload.pagina),
  };
}

export async function buscarDetalhe(payload: PortalDetailPayload): Promise<unknown> {
  return requestPortal({
    path: env.TRANSPARENCIA_DETALHAR_PATH,
    query: {
      codVinculo: payload.codVinculo,
      ano: payload.ano,
      mes: payload.mes,
    },
  });
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(): number {
  return 500 + Math.floor(Math.random() * 501);
}

function getVinculoIdFromRow(row: Record<string, unknown>): string {
  return toText(row.codVinculo ?? row.id ?? row.servidorId ?? row.codigo);
}

function mapPublicServant(
  row: Record<string, unknown>,
  detail: unknown,
  ano: number,
  mes: number,
  margemPercentual: number,
  taxasCredito: TaxasCredito,
): PublicServantRecord {
  const rubricas = extractRubricas(detail);
  const classificacaoConsignado = classificarConsignado(rubricas.map((item) => item.nome));
  const detailHeader =
    ((detail as Record<string, unknown> | undefined)?.cabecalho as Record<string, unknown>) ?? {};

  const regime = toText(row.regimeServidor ?? row.regime);
  const vinculo = toText(row.vinculoServidor ?? row.vinculo);
  const valorLiquido = toNumber(row.valorLiquido);
  const valorBruto = toNumber(row.valorBruto);
  const dataAdmissao = toText(detailHeader.dataAdmissao ?? row.dataAdmissao);
  const margem = calcularMargem({ valorLiquido, rubricas, margemPercentual });
  const scoreResult = calcularScore({
    valorLiquido,
    regime,
    vinculo,
    dataAdmissao,
    classificacaoConsignado,
    classificacaoMargem: margem.classificacaoMargem,
  });
  const simulacoes = gerarSimulacoes({
    margemDisponivel: margem.margemDisponivel,
    classificacaoConsignado,
    taxas: taxasCredito,
  });
  const recomendacao = recomendarProduto({
    regime,
    vinculo,
    margemDisponivel: margem.margemDisponivel,
    classificacaoConsignado,
    score: scoreResult.score,
  });

  return {
    sourceExternalId: getVinculoIdFromRow(row),
    name: toText(row.nomeServidor ?? row.nome),
    cargo: toText(row.cargoServidor ?? row.cargo),
    unidadeGestora: toText(row.ugServidor ?? row.unidadeGestora),
    lotacao: toText(row.lotacaoServidor ?? row.lotacao),
    mes,
    ano,
    valorLiquido,
    valorBruto,
    dataAdmissao,
    regime,
    vinculo,
    margemMaxima: margem.margemMaxima,
    margemUtilizada: margem.margemUtilizada,
    margemDisponivel: margem.margemDisponivel,
    classificacaoMargem: margem.classificacaoMargem,
    score: scoreResult.score,
    classificacaoScore: scoreResult.classificacaoScore,
    valorMaximoLiberado: simulacoes.melhor.valorMaximoLiberado,
    melhorParcela: simulacoes.melhor.parcela,
    melhorPrazo: simulacoes.melhor.prazo,
    totalPago: simulacoes.melhor.totalPago,
    produtoRecomendado: recomendacao.produtoRecomendado,
    motivoRecomendacao: recomendacao.motivo,
    prioridadeAtendimento: recomendacao.prioridade,
    classificacaoConsignado,
    rawListPayload: row,
    rawDetailPayload: detail,
  };
}

export async function salvarCliente(
  servant: PublicServantRecord,
  actorUserId: number,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO loan_public_servants (
      source_external_id,
      name,
      cargo,
      unidade_gestora,
      lotacao,
      mes,
      ano,
      valor_liquido,
      valor_bruto,
      data_admissao,
      regime,
      vinculo,
      margem_maxima,
      margem_utilizada,
      margem_disponivel,
      classificacao_margem,
      classificacao_consignado,
      score,
      classificacao_score,
      valor_maximo_liberado,
      melhor_parcela,
      melhor_prazo,
      total_pago,
      produto_recomendado,
      motivo_recomendacao,
      prioridade_atendimento,
      score_oportunidade,
      raw_list_payload,
      raw_detail_payload,
      imported_by
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28::jsonb, $29::jsonb, $30
    )
    ON CONFLICT (name, unidade_gestora, mes, ano) DO NOTHING
    RETURNING id`,
    [
      servant.sourceExternalId,
      servant.name,
      servant.cargo,
      servant.unidadeGestora,
      servant.lotacao,
      servant.mes,
      servant.ano,
      servant.valorLiquido,
      servant.valorBruto,
      servant.dataAdmissao,
      servant.regime,
      servant.vinculo,
      servant.margemMaxima,
      servant.margemUtilizada,
      servant.margemDisponivel,
      servant.classificacaoMargem,
      servant.classificacaoConsignado,
      servant.score,
      servant.classificacaoScore,
      servant.valorMaximoLiberado,
      servant.melhorParcela,
      servant.melhorPrazo,
      servant.totalPago,
      servant.produtoRecomendado,
      servant.motivoRecomendacao,
      servant.prioridadeAtendimento,
      servant.score,
      JSON.stringify(servant.rawListPayload ?? {}),
      JSON.stringify(servant.rawDetailPayload ?? {}),
      actorUserId,
    ],
  );
  return Boolean(result.rows[0]);
}

async function retryDetalhe(payload: PortalDetailPayload): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await buscarDetalhe(payload);
    } catch (error) {
      lastError = error;
      await delayMs(350 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao obter detalhes");
}

export async function importarServidores(params: {
  ano: number;
  mes: number;
  tamanho: number;
  nome?: string;
  maxPaginas: number;
  actorUserId: number;
  onProgress?: (progress: {
    processados: number;
    estimadoTotal: number;
    importados: number;
    duplicados: number;
    erros: number;
  }) => void;
}): Promise<{
  importados: number;
  comConsignado: number;
  semConsignado: number;
  duplicados: number;
  erros: number;
}> {
  await ensureTransparenciaStructures();
  let importados = 0;
  let comConsignado = 0;
  let semConsignado = 0;
  let duplicados = 0;
  let erros = 0;
  let processados = 0;
  const processedIds = new Set<string>();

  const seeds = params.nome?.trim() ? [params.nome.trim()] : defaultSearchSeeds;
  const estimadoTotal = Math.max(1, seeds.length * params.maxPaginas * params.tamanho);
  const margemPercentual = await obterPercentualMargem();
  const taxasCredito = await obterTaxasCredito();
  params.onProgress?.({ processados, estimadoTotal, importados, duplicados, erros });

  for (const seed of seeds) {
    let pagina = 1;
    let totalPaginas = 1;

    while (pagina <= totalPaginas && pagina <= params.maxPaginas) {
      let items: unknown[] = [];
      try {
        const response = await buscarLista({
          nome: seed,
          ano: params.ano,
          mes: params.mes,
          pagina,
          tamanho: params.tamanho,
        });
        items = response.items;
        totalPaginas = Math.max(totalPaginas, response.totalPages);
      } catch {
        erros += 1;
        break;
      }

      for (const rowRaw of items) {
        const row = rowRaw as Record<string, unknown>;
        const externalId = getVinculoIdFromRow(row);
        if (!externalId || processedIds.has(externalId)) {
          continue;
        }
        processedIds.add(externalId);

        try {
          await delayMs(randomDelay());
          const detail = await retryDetalhe({
            codVinculo: externalId,
            ano: params.ano,
            mes: params.mes,
          });

          const servant = mapPublicServant(
            row,
            detail,
            params.ano,
            params.mes,
            margemPercentual,
            taxasCredito,
          );
          if (!servant.name || !servant.unidadeGestora) {
            erros += 1;
            continue;
          }
          const inserted = await salvarCliente(servant, params.actorUserId);
          if (!inserted) {
            duplicados += 1;
            processados += 1;
            params.onProgress?.({ processados, estimadoTotal, importados, duplicados, erros });
            continue;
          }

          importados += 1;
          if (servant.classificacaoConsignado === "Com consignado") comConsignado += 1;
          else semConsignado += 1;
          processados += 1;
          params.onProgress?.({ processados, estimadoTotal, importados, duplicados, erros });
        } catch {
          erros += 1;
          processados += 1;
          params.onProgress?.({ processados, estimadoTotal, importados, duplicados, erros });
        }
      }

      if (items.length === 0) break;
      pagina += 1;
    }
  }

  return { importados, comConsignado, semConsignado, duplicados, erros };
}

export async function simularServidorImportado(params: {
  id: number;
}): Promise<{
  valorMaximoLiberado: number;
  melhorParcela: number;
  melhorPrazo: number;
  totalPago: number;
  produtoRecomendado: string;
  prioridadeAtendimento: "Alta" | "Media" | "Baixa";
}> {
  await ensureTransparenciaStructures();
  const [margemPercentual, taxas] = await Promise.all([obterPercentualMargem(), obterTaxasCredito()]);
  const result = await pool.query<{
    id: number;
    valor_liquido: number;
    regime: string;
    vinculo: string;
    data_admissao: string;
    classificacao_consignado: "Com consignado" | "Sem consignado";
    raw_detail_payload: unknown;
  }>(
    `SELECT id, valor_liquido, regime, vinculo, data_admissao, classificacao_consignado, raw_detail_payload
     FROM loan_public_servants
     WHERE id = $1
     LIMIT 1`,
    [params.id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Servidor nao encontrado.");
  }
  const rubricas = extractRubricas(row.raw_detail_payload);
  const margem = calcularMargem({
    valorLiquido: Number(row.valor_liquido),
    rubricas,
    margemPercentual,
  });
  const scoreResult = calcularScore({
    valorLiquido: Number(row.valor_liquido),
    regime: row.regime ?? "",
    vinculo: row.vinculo ?? "",
    dataAdmissao: row.data_admissao ?? "",
    classificacaoConsignado: row.classificacao_consignado ?? "Sem consignado",
    classificacaoMargem: margem.classificacaoMargem,
  });
  const sim = gerarSimulacoes({
    margemDisponivel: margem.margemDisponivel,
    classificacaoConsignado: row.classificacao_consignado ?? "Sem consignado",
    taxas,
  });
  const recomendacao = recomendarProduto({
    regime: row.regime ?? "",
    vinculo: row.vinculo ?? "",
    margemDisponivel: margem.margemDisponivel,
    classificacaoConsignado: row.classificacao_consignado ?? "Sem consignado",
    score: scoreResult.score,
  });

  await pool.query(
    `UPDATE loan_public_servants
     SET
      margem_maxima = $1,
      margem_utilizada = $2,
      margem_disponivel = $3,
      classificacao_margem = $4,
      score = $5,
      classificacao_score = $6,
      score_oportunidade = $5,
      valor_maximo_liberado = $7,
      melhor_parcela = $8,
      melhor_prazo = $9,
      total_pago = $10,
      produto_recomendado = $11,
      motivo_recomendacao = $12,
      prioridade_atendimento = $13
     WHERE id = $14`,
    [
      margem.margemMaxima,
      margem.margemUtilizada,
      margem.margemDisponivel,
      margem.classificacaoMargem,
      scoreResult.score,
      scoreResult.classificacaoScore,
      sim.melhor.valorMaximoLiberado,
      sim.melhor.parcela,
      sim.melhor.prazo,
      sim.melhor.totalPago,
      recomendacao.produtoRecomendado,
      recomendacao.motivo,
      recomendacao.prioridade,
      params.id,
    ],
  );

  return {
    valorMaximoLiberado: sim.melhor.valorMaximoLiberado,
    melhorParcela: sim.melhor.parcela,
    melhorPrazo: sim.melhor.prazo,
    totalPago: sim.melhor.totalPago,
    produtoRecomendado: recomendacao.produtoRecomendado,
    prioridadeAtendimento: recomendacao.prioridade,
  };
}
