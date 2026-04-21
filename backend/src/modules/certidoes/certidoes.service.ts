import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import { pool } from "../../db/pool";
import {
  CertidaoRecord,
  CertidaoStatus,
  CertidaoTipo,
  CertificateConfigRecord,
  MonthlyObligationRecord,
  NfseDraftRecord,
  NfseDraftStatus,
  NfseTemplateKey,
  MonthlyObligationType,
  MonthlyUploadMode,
  RunnerMode,
} from "./certidoes.types";
import { CndtProvider } from "./providers/cndt.provider";
import { CnfProvider } from "./providers/cnf.provider";
import { CrfProvider } from "./providers/crf.provider";
import { extractControlCodeByLabel } from "./providers/provider.utils";
import { BackendRunner } from "./runners/backend.runner";
import { AgentRunner } from "./runners/agent.runner";
import { PDFParse } from "pdf-parse";

const CERT_TYPES: CertidaoTipo[] = ["CNDT", "CNF", "CRF"];
const EXPIRING_WINDOW_DAYS = Number(process.env.CERTIDOES_EXPIRING_WINDOW_DAYS || 7);
const CERT_STORAGE_ROOT = path.resolve(process.cwd(), "storage", "certidoes");
const MONTHLY_STORAGE_ROOT = path.resolve(process.cwd(), "storage", "documentos-mensais");
const NFSE_STORAGE_ROOT = path.resolve(process.cwd(), "storage", "nfse");
const AGENT_BASE_URL = (process.env.VPN_AGENT_URL || "http://127.0.0.1:48321").replace(/\/+$/, "");

const providers = {
  CNDT: new CndtProvider(),
  CNF: new CnfProvider(),
  CRF: new CrfProvider(),
} as const;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

let structureEnsured = false;

function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, "");
}

function computeStatusByExpiry(expiryDate: string | null): CertidaoStatus {
  if (!expiryDate) return "pendente";
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const expiry = new Date(`${expiryDate}T00:00:00`).getTime();
  const diffDays = Math.floor((expiry - todayStart) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "vencida";
  if (diffDays <= EXPIRING_WINDOW_DAYS) return "vencendo";
  return "valida";
}

async function resolveRunnerMode(): Promise<RunnerMode> {
  const forced = (process.env.CERTIDOES_FORCE_RUNNER || "").trim().toLowerCase();
  if (forced === "backend" || forced === "agent") return forced;
  if (process.platform !== "win32") return "backend";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`${AGENT_BASE_URL}/v1/health`, { signal: controller.signal });
    if (response.ok) return "agent";
  } catch {
    // fallback backend
  } finally {
    clearTimeout(timeout);
  }
  return "backend";
}

function parseCertificateExpiryFromPem(pemText: string): string | null {
  try {
    const cert = forge.pki.certificateFromPem(pemText);
    if (!cert.validity?.notAfter) return null;
    return cert.validity.notAfter.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function parseCertificateExpiryFromP12(base64Content: string, password: string | null): string | null {
  try {
    const derBinary = Buffer.from(base64Content, "base64").toString("binary");
    const der = forge.util.createBuffer(derBinary);
    const asn1 = forge.asn1.fromDer(der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password ?? "");
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBags = bags[forge.pki.oids.certBag] ?? [];
    const first = certBags[0]?.cert;
    if (!first?.validity?.notAfter) return null;
    return first.validity.notAfter.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function parseCertificateExpiry(input: {
  certificateName?: string | null;
  certificateContentBase64?: string | null;
  certificatePassword?: string | null;
}): string | null {
  const name = (input.certificateName || "").toLowerCase();
  const base64Content = input.certificateContentBase64 || "";
  if (!name || !base64Content) return null;
  const contentBuffer = Buffer.from(base64Content, "base64");
  if (name.endsWith(".pem") || name.endsWith(".crt") || name.endsWith(".cer")) {
    return parseCertificateExpiryFromPem(contentBuffer.toString("utf8"));
  }
  if (name.endsWith(".pfx") || name.endsWith(".p12")) {
    return parseCertificateExpiryFromP12(base64Content, input.certificatePassword ?? null);
  }
  return parseCertificateExpiryFromPem(contentBuffer.toString("utf8"));
}

async function ensureCertidoesStructures(): Promise<void> {
  if (structureEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents_certificate_config (
      id SERIAL PRIMARY KEY,
      cnpj TEXT NOT NULL UNIQUE,
      runner_mode TEXT NOT NULL DEFAULT 'backend' CHECK (runner_mode IN ('backend', 'agent')),
      certificate_name TEXT,
      certificate_content_base64 TEXT,
      certificate_password TEXT,
      certificate_expires_at DATE,
      certificate_updated_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id),
      updated_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents_certidoes (
      id SERIAL PRIMARY KEY,
      cnpj TEXT NOT NULL,
      cert_type TEXT NOT NULL CHECK (cert_type IN ('CNDT', 'CNF', 'CRF')),
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('valida', 'vencendo', 'vencida', 'pendente', 'falha')),
      issue_date DATE,
      expiry_date DATE,
      control_code TEXT,
      source_url TEXT,
      storage_path TEXT,
      file_hash TEXT,
      last_checked_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      last_error TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (cnpj, cert_type)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents_certidoes_runs (
      id SERIAL PRIMARY KEY,
      cnpj TEXT NOT NULL,
      cert_type TEXT NOT NULL CHECK (cert_type IN ('CNDT', 'CNF', 'CRF')),
      runner_mode TEXT NOT NULL CHECK (runner_mode IN ('backend', 'agent')),
      status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
      message TEXT,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL,
      created_by INT REFERENCES users(id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents_monthly_obligations (
      id SERIAL PRIMARY KEY,
      cnpj TEXT NOT NULL,
      obligation_type TEXT NOT NULL CHECK (obligation_type IN ('SIMPLES', 'FGTS')),
      competency TEXT NOT NULL,
      upload_mode TEXT NOT NULL DEFAULT 'single' CHECK (upload_mode IN ('single', 'separate')),
      single_file_name TEXT,
      single_storage_path TEXT,
      single_file_hash TEXT,
      boleto_file_name TEXT,
      boleto_storage_path TEXT,
      boleto_file_hash TEXT,
      receipt_file_name TEXT,
      receipt_storage_path TEXT,
      receipt_file_hash TEXT,
      updated_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (cnpj, obligation_type, competency)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents_nfse_drafts (
      id SERIAL PRIMARY KEY,
      cnpj TEXT NOT NULL,
      template_key TEXT NOT NULL CHECK (template_key IN ('DIA_5_RETIDO', 'DIA_20_SEM_RETENCAO')),
      competency TEXT NOT NULL DEFAULT '',
      tomador_label TEXT NOT NULL,
      iss_mode TEXT NOT NULL,
      reference_day INT NOT NULL CHECK (reference_day IN (5, 20)),
      service_description TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
      status TEXT NOT NULL DEFAULT 'preparada' CHECK (status IN ('preparada', 'emitida')),
      invoice_number TEXT,
      verification_code TEXT,
      emitted_at TIMESTAMPTZ,
      xml_file_name TEXT,
      xml_storage_path TEXT,
      pdf_file_name TEXT,
      pdf_storage_path TEXT,
      created_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE documents_nfse_drafts ADD COLUMN IF NOT EXISTS competency TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE documents_nfse_drafts ADD COLUMN IF NOT EXISTS invoice_number TEXT;`);
  await pool.query(`ALTER TABLE documents_nfse_drafts ADD COLUMN IF NOT EXISTS verification_code TEXT;`);
  await pool.query(`ALTER TABLE documents_nfse_drafts ADD COLUMN IF NOT EXISTS emitted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE documents_nfse_drafts ADD COLUMN IF NOT EXISTS xml_file_name TEXT;`);
  await pool.query(`ALTER TABLE documents_nfse_drafts ADD COLUMN IF NOT EXISTS xml_storage_path TEXT;`);
  await pool.query(`ALTER TABLE documents_nfse_drafts ADD COLUMN IF NOT EXISTS pdf_file_name TEXT;`);
  await pool.query(`ALTER TABLE documents_nfse_drafts ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_certidoes_status ON documents_certidoes(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_certidoes_expiry ON documents_certidoes(expiry_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_certidoes_checked ON documents_certidoes(last_checked_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_monthly_cnpj ON documents_monthly_obligations(cnpj);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_nfse_drafts_cnpj_created ON documents_nfse_drafts(cnpj, created_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_nfse_drafts_cnpj_invoice ON documents_nfse_drafts(cnpj, invoice_number) WHERE invoice_number IS NOT NULL;`);
  structureEnsured = true;
}

async function getConfigByCnpj(cnpj: string): Promise<CertificateConfigRecord | null> {
  const normalized = normalizeCnpj(cnpj);
  const result = await pool.query<{
    cnpj: string;
    runner_mode: RunnerMode;
    certificate_name: string | null;
    certificate_content_base64: string | null;
    certificate_password: string | null;
    certificate_expires_at: string | null;
    certificate_updated_at: string | null;
  }>(
    `SELECT cnpj, runner_mode, certificate_name, certificate_content_base64, certificate_password, certificate_expires_at::text AS certificate_expires_at, certificate_updated_at::text AS certificate_updated_at
     FROM documents_certificate_config
     WHERE cnpj = $1`,
    [normalized],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    cnpj: row.cnpj,
    runnerMode: row.runner_mode,
    certificateName: row.certificate_name,
    certificateContentBase64: row.certificate_content_base64,
    certificatePassword: row.certificate_password,
    certificateExpiresAt: row.certificate_expires_at,
    certificateUpdatedAt: row.certificate_updated_at,
  };
}

async function ensureCertRows(cnpj: string): Promise<void> {
  for (const certType of CERT_TYPES) {
    await pool.query(
      `INSERT INTO documents_certidoes (cnpj, cert_type)
       VALUES ($1, $2)
       ON CONFLICT (cnpj, cert_type) DO NOTHING`,
      [cnpj, certType],
    );
  }
}

async function savePdf(cnpj: string, certType: CertidaoTipo, base64: string): Promise<{ storagePath: string; fileHash: string }> {
  await fs.mkdir(CERT_STORAGE_ROOT, { recursive: true });
  const filename = `${cnpj}-${certType}.pdf`;
  const filePath = path.join(CERT_STORAGE_ROOT, filename);
  const data = Buffer.from(base64, "base64");
  await fs.writeFile(filePath, data);
  return {
    storagePath: filePath,
    fileHash: createHash("sha256").update(data).digest("hex"),
  };
}

function sanitizeForFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function saveMonthlyFile(input: {
  cnpj: string;
  obligationType: MonthlyObligationType;
  competency: string;
  kind: "single" | "boleto" | "receipt";
  fileName: string;
  base64: string;
}): Promise<{ fileName: string; storagePath: string; fileHash: string }> {
  await fs.mkdir(MONTHLY_STORAGE_ROOT, { recursive: true });
  const originalName = input.fileName.trim() || `${input.kind}.pdf`;
  const ext = path.extname(originalName) || ".pdf";
  const safeName = sanitizeForFilename(`${input.cnpj}-${input.obligationType}-${input.competency}-${input.kind}${ext}`);
  const storagePath = path.join(MONTHLY_STORAGE_ROOT, safeName);
  const data = Buffer.from(input.base64, "base64");
  await fs.writeFile(storagePath, data);
  return {
    fileName: originalName,
    storagePath,
    fileHash: createHash("sha256").update(data).digest("hex"),
  };
}

async function saveNfseDraftFile(input: {
  cnpj: string;
  draftId: number;
  kind: "xml" | "pdf";
  fileName: string;
  base64: string;
}): Promise<{ fileName: string; storagePath: string }> {
  await fs.mkdir(NFSE_STORAGE_ROOT, { recursive: true });
  const originalName = input.fileName.trim() || `nfse-${input.kind}.${input.kind}`;
  const ext = path.extname(originalName) || `.${input.kind}`;
  const safeName = sanitizeForFilename(`${input.cnpj}-nfse-${input.draftId}-${input.kind}${ext}`);
  const storagePath = path.join(NFSE_STORAGE_ROOT, safeName);
  const data = Buffer.from(input.base64, "base64");
  await fs.writeFile(storagePath, data);
  return {
    fileName: originalName,
    storagePath,
  };
}

function selectRunner(mode: RunnerMode) {
  if (mode === "agent") return new AgentRunner();
  return new BackendRunner();
}

function cleanPdfText(rawText: string): string {
  return rawText.replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
}

function extractControlCodeFromText(certType: CertidaoTipo, rawText: string): string | null {
  const labelsByType: Record<CertidaoTipo, string[]> = {
    CNDT: ["Código de controle", "Código de verificação", "Número da certidão", "Certidão nº"],
    CNF: ["Código de controle", "Número da certidão", "Número", "Certidão nº"],
    CRF: ["Certificação Número", "Chave de identificação", "Código de controle", "Número da certidão", "Certificado nº"],
  };
  return extractControlCodeByLabel(rawText, labelsByType[certType]);
}

export async function extractManualDataFromPdf(input: {
  certType: CertidaoTipo;
  pdfBase64: string;
}): Promise<{
  issueDate: string | null;
  expiryDate: string | null;
  controlCode: string | null;
  rawText: string | null;
}> {
  const data = Buffer.from(input.pdfBase64, "base64");
  const parser = new PDFParse({ data });
  let parsedText = "";
  try {
    const parsed = await parser.getText();
    parsedText = parsed.text || "";
  } finally {
    await parser.destroy();
  }
  const rawText = cleanPdfText(parsedText);
  if (!rawText) {
    return {
      issueDate: null,
      expiryDate: null,
      controlCode: null,
      rawText: null,
    };
  }
  const controlCode = extractControlCodeFromText(input.certType, rawText);
  const normalized = providers[input.certType].normalize({
    ok: true,
    rawText,
    controlCode,
  });
  return {
    issueDate: normalized.issueDate ?? null,
    expiryDate: normalized.expiryDate ?? null,
    controlCode: normalized.controlCode ?? null,
    rawText: normalized.rawText ?? rawText,
  };
}

export async function upsertCertificateConfig(input: {
  cnpj: string;
  runnerMode?: RunnerMode;
  certificateName?: string | null;
  certificateContentBase64?: string | null;
  certificatePassword?: string | null;
  certificateExpiresAt?: string | null;
  userId: number;
}): Promise<void> {
  await ensureCertidoesStructures();
  const cnpj = normalizeCnpj(input.cnpj);
  const resolvedRunnerMode = input.runnerMode ?? (await resolveRunnerMode());
  const parsedExpiry = parseCertificateExpiry({
    certificateName: input.certificateName,
    certificateContentBase64: input.certificateContentBase64,
    certificatePassword: input.certificatePassword,
  });
  const certificateExpiresAt = input.certificateExpiresAt ?? parsedExpiry ?? null;
  await pool.query(
    `INSERT INTO documents_certificate_config (
      cnpj, runner_mode, certificate_name, certificate_content_base64, certificate_password, certificate_expires_at, certificate_updated_at, created_by, updated_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6::date, NOW(), $7, $7, NOW())
    ON CONFLICT (cnpj) DO UPDATE SET
      runner_mode = EXCLUDED.runner_mode,
      certificate_name = COALESCE(EXCLUDED.certificate_name, documents_certificate_config.certificate_name),
      certificate_content_base64 = COALESCE(EXCLUDED.certificate_content_base64, documents_certificate_config.certificate_content_base64),
      certificate_password = COALESCE(EXCLUDED.certificate_password, documents_certificate_config.certificate_password),
      certificate_expires_at = COALESCE(EXCLUDED.certificate_expires_at, documents_certificate_config.certificate_expires_at),
      certificate_updated_at = CASE
        WHEN EXCLUDED.certificate_content_base64 IS NOT NULL OR EXCLUDED.certificate_name IS NOT NULL OR EXCLUDED.certificate_password IS NOT NULL
          THEN NOW()
        ELSE documents_certificate_config.certificate_updated_at
      END,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`,
    [
      cnpj,
      resolvedRunnerMode,
      input.certificateName ?? null,
      input.certificateContentBase64 ?? null,
      input.certificatePassword ?? null,
      certificateExpiresAt,
      input.userId,
    ],
  );
  await ensureCertRows(cnpj);
}

export async function getCertidoesStatus(cnpj: string): Promise<{
  config: Omit<CertificateConfigRecord, "certificateContentBase64" | "certificatePassword"> | null;
  items: CertidaoRecord[];
}> {
  await ensureCertidoesStructures();
  const normalized = normalizeCnpj(cnpj);
  await ensureCertRows(normalized);

  const config = await getConfigByCnpj(normalized);
  const result = await pool.query<{
    cert_type: CertidaoTipo;
    status: CertidaoStatus;
    issue_date: string | null;
    expiry_date: string | null;
    control_code: string | null;
    source_url: string | null;
    storage_path: string | null;
    file_hash: string | null;
    last_checked_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    updated_at: string | null;
  }>(
    `SELECT cert_type, status, issue_date::text AS issue_date, expiry_date::text AS expiry_date, control_code, source_url, storage_path, file_hash, last_checked_at::text AS last_checked_at, last_success_at::text AS last_success_at, last_error, updated_at::text AS updated_at
     FROM documents_certidoes
     WHERE cnpj = $1
     ORDER BY cert_type ASC`,
    [normalized],
  );
  return {
    config: config
      ? {
          cnpj: config.cnpj,
          runnerMode: config.runnerMode,
          certificateName: config.certificateName,
          certificateExpiresAt: config.certificateExpiresAt,
          certificateUpdatedAt: config.certificateUpdatedAt,
        }
      : null,
    items: result.rows.map((row) => ({
      certType: row.cert_type,
      status: row.status,
      issueDate: row.issue_date,
      expiryDate: row.expiry_date,
      controlCode: row.control_code,
      sourceUrl: row.source_url,
      storagePath: row.storage_path,
      fileHash: row.file_hash,
      lastCheckedAt: row.last_checked_at,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    })),
  };
}

async function runSingleRefresh(cnpj: string, certType: CertidaoTipo, userId: number | null): Promise<void> {
  const config = await getConfigByCnpj(cnpj);
  const now = new Date();
  const startedAt = now.toISOString();
  if (!config) {
    await pool.query(
      `UPDATE documents_certidoes
       SET status = 'falha', last_checked_at = NOW(), last_error = $3, updated_at = NOW()
       WHERE cnpj = $1 AND cert_type = $2`,
      [cnpj, certType, "Configuração de certificado não encontrada."],
    );
    await pool.query(
      `INSERT INTO documents_certidoes_runs (cnpj, cert_type, runner_mode, status, message, started_at, finished_at, created_by)
       VALUES ($1, $2, 'backend', 'failure', $3, $4, NOW(), $5)`,
      [cnpj, certType, "Configuração de certificado não encontrada.", startedAt, userId],
    );
    return;
  }

  const provider = providers[certType];
  const runner = selectRunner(config.runnerMode);
  const payload = await runner.execute({ certType, cnpj, certificate: config });
  const normalized = provider.normalize(payload);

  if (!normalized.ok || !normalized.expiryDate) {
    await pool.query(
      `UPDATE documents_certidoes
       SET status = 'falha', last_checked_at = NOW(), last_error = $3, updated_at = NOW()
       WHERE cnpj = $1 AND cert_type = $2`,
      [cnpj, certType, normalized.errorMessage || "Falha ao atualizar certidão."],
    );
    await pool.query(
      `INSERT INTO documents_certidoes_runs (cnpj, cert_type, runner_mode, status, message, started_at, finished_at, created_by)
       VALUES ($1, $2, $3, 'failure', $4, $5, NOW(), $6)`,
      [cnpj, certType, config.runnerMode, normalized.errorMessage || "Falha ao atualizar certidão.", startedAt, userId],
    );
    return;
  }

  let storagePath: string | null = null;
  let fileHash: string | null = null;
  if (normalized.pdfBase64) {
    const stored = await savePdf(cnpj, certType, normalized.pdfBase64);
    storagePath = stored.storagePath;
    fileHash = stored.fileHash;
  }

  const status = computeStatusByExpiry(normalized.expiryDate);
  await pool.query(
    `UPDATE documents_certidoes
     SET status = $3,
         issue_date = $4::date,
         expiry_date = $5::date,
         control_code = $6,
         source_url = $7,
         storage_path = COALESCE($8, storage_path),
         file_hash = COALESCE($9, file_hash),
         last_checked_at = NOW(),
         last_success_at = NOW(),
         last_error = NULL,
         updated_at = NOW()
     WHERE cnpj = $1 AND cert_type = $2`,
    [
      cnpj,
      certType,
      status,
      normalized.issueDate,
      normalized.expiryDate,
      normalized.controlCode,
      normalized.sourceUrl,
      storagePath,
      fileHash,
    ],
  );
  await pool.query(
    `INSERT INTO documents_certidoes_runs (cnpj, cert_type, runner_mode, status, message, started_at, finished_at, created_by)
     VALUES ($1, $2, $3, 'success', $4, $5, NOW(), $6)`,
    [cnpj, certType, config.runnerMode, "Certidão atualizada com sucesso.", startedAt, userId],
  );
}

export async function refreshCertidoes(input: {
  cnpj: string;
  certTypes?: CertidaoTipo[];
  userId: number | null;
}): Promise<void> {
  await ensureCertidoesStructures();
  const cnpj = normalizeCnpj(input.cnpj);
  await ensureCertRows(cnpj);
  const certTypes = input.certTypes && input.certTypes.length > 0 ? input.certTypes : CERT_TYPES;
  for (const certType of certTypes) {
    await runSingleRefresh(cnpj, certType, input.userId);
  }
}

export async function upsertManualCertidao(input: {
  cnpj: string;
  certType: CertidaoTipo;
  issueDate?: string | null;
  expiryDate: string;
  controlCode?: string | null;
  sourceUrl?: string | null;
  pdfBase64?: string | null;
  userId: number;
}): Promise<void> {
  await ensureCertidoesStructures();
  const cnpj = normalizeCnpj(input.cnpj);
  await ensureCertRows(cnpj);

  let storagePath: string | null = null;
  let fileHash: string | null = null;
  if (input.pdfBase64?.trim()) {
    const stored = await savePdf(cnpj, input.certType, input.pdfBase64.trim());
    storagePath = stored.storagePath;
    fileHash = stored.fileHash;
  }

  const status = computeStatusByExpiry(input.expiryDate);
  await pool.query(
    `UPDATE documents_certidoes
     SET status = $3,
         issue_date = $4::date,
         expiry_date = $5::date,
         control_code = $6,
         source_url = $7,
         storage_path = COALESCE($8, storage_path),
         file_hash = COALESCE($9, file_hash),
         last_checked_at = NOW(),
         last_success_at = NOW(),
         last_error = NULL,
         updated_at = NOW()
     WHERE cnpj = $1 AND cert_type = $2`,
    [
      cnpj,
      input.certType,
      status,
      input.issueDate ?? null,
      input.expiryDate,
      input.controlCode ?? null,
      input.sourceUrl ?? "manual://usuario",
      storagePath,
      fileHash,
    ],
  );

  await pool.query(
    `INSERT INTO documents_certidoes_runs (cnpj, cert_type, runner_mode, status, message, started_at, finished_at, created_by)
     VALUES ($1, $2, 'backend', 'success', $3, NOW(), NOW(), $4)`,
    [cnpj, input.certType, "Certidão registrada manualmente.", input.userId],
  );
}

export async function autoRefreshExpiringCertidoes(): Promise<void> {
  await ensureCertidoesStructures();
  const configs = await pool.query<{ cnpj: string }>(`SELECT cnpj FROM documents_certificate_config`);
  for (const config of configs.rows) {
    const status = await getCertidoesStatus(config.cnpj);
    const pendingTypes = status.items
      .filter((item) => item.status === "vencendo" || item.status === "vencida" || item.status === "falha" || item.status === "pendente")
      .map((item) => item.certType);
    if (pendingTypes.length === 0) continue;
    await refreshCertidoes({ cnpj: config.cnpj, certTypes: pendingTypes, userId: null });
  }
}

export async function getCertidaoDownloadPath(cnpj: string, certType: CertidaoTipo): Promise<string | null> {
  await ensureCertidoesStructures();
  const result = await pool.query<{ storage_path: string | null }>(
    `SELECT storage_path FROM documents_certidoes WHERE cnpj = $1 AND cert_type = $2`,
    [normalizeCnpj(cnpj), certType],
  );
  const filePath = result.rows[0]?.storage_path ?? null;
  if (!filePath) return null;
  return (await pathExists(filePath)) ? filePath : null;
}

export async function listMonthlyObligations(cnpj: string): Promise<MonthlyObligationRecord[]> {
  await ensureCertidoesStructures();
  const normalized = normalizeCnpj(cnpj);
  const result = await pool.query<{
    cnpj: string;
    obligation_type: MonthlyObligationType;
    competency: string;
    upload_mode: MonthlyUploadMode;
    single_file_name: string | null;
    single_storage_path: string | null;
    boleto_file_name: string | null;
    boleto_storage_path: string | null;
    receipt_file_name: string | null;
    receipt_storage_path: string | null;
    updated_at: string | null;
  }>(
    `SELECT cnpj, obligation_type, competency, upload_mode, single_file_name, single_storage_path, boleto_file_name, boleto_storage_path, receipt_file_name, receipt_storage_path, updated_at::text AS updated_at
     FROM documents_monthly_obligations
     WHERE cnpj = $1
     ORDER BY competency DESC, obligation_type ASC`,
    [normalized],
  );
  return result.rows.map((row) => ({
    cnpj: row.cnpj,
    obligationType: row.obligation_type,
    competency: row.competency,
    uploadMode: row.upload_mode,
    singleFileName: row.single_file_name,
    singleStoragePath: row.single_storage_path,
    boletoFileName: row.boleto_file_name,
    boletoStoragePath: row.boleto_storage_path,
    receiptFileName: row.receipt_file_name,
    receiptStoragePath: row.receipt_storage_path,
    updatedAt: row.updated_at,
  }));
}

export async function listNfseDrafts(input: {
  cnpj: string;
  templateKey?: NfseTemplateKey;
  status?: NfseDraftStatus;
  competency?: string;
  search?: string;
}): Promise<NfseDraftRecord[]> {
  await ensureCertidoesStructures();
  const normalized = normalizeCnpj(input.cnpj);
  const whereParts: string[] = ["cnpj = $1"];
  const values: Array<string> = [normalized];
  if (input.templateKey) {
    values.push(input.templateKey);
    whereParts.push(`template_key = $${values.length}`);
  }
  if (input.status) {
    values.push(input.status);
    whereParts.push(`status = $${values.length}`);
  }
  if (input.competency) {
    values.push(input.competency);
    whereParts.push(`competency = $${values.length}`);
  }
  if (input.search?.trim()) {
    values.push(`%${input.search.trim()}%`);
    whereParts.push(`(service_description ILIKE $${values.length} OR tomador_label ILIKE $${values.length} OR COALESCE(invoice_number, '') ILIKE $${values.length})`);
  }
  const result = await pool.query<{
    id: number;
    cnpj: string;
    template_key: NfseTemplateKey;
    competency: string;
    tomador_label: string;
    iss_mode: string;
    reference_day: number;
    service_description: string;
    amount: string;
    status: NfseDraftStatus;
    invoice_number: string | null;
    verification_code: string | null;
    emitted_at: string | null;
    xml_file_name: string | null;
    xml_storage_path: string | null;
    pdf_file_name: string | null;
    pdf_storage_path: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, cnpj, template_key, competency, tomador_label, iss_mode, reference_day, service_description, amount::text AS amount, status, invoice_number, verification_code, emitted_at::text AS emitted_at, xml_file_name, xml_storage_path, pdf_file_name, pdf_storage_path, created_at::text AS created_at, updated_at::text AS updated_at
     FROM documents_nfse_drafts
     WHERE ${whereParts.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 100`,
    values,
  );
  return result.rows.map((row) => ({
    id: row.id,
    cnpj: row.cnpj,
    templateKey: row.template_key,
    competency: row.competency,
    tomadorLabel: row.tomador_label,
    issMode: row.iss_mode,
    referenceDay: row.reference_day,
    serviceDescription: row.service_description,
    amount: Number(row.amount),
    status: row.status,
    invoiceNumber: row.invoice_number,
    verificationCode: row.verification_code,
    emittedAt: row.emitted_at,
    xmlFileName: row.xml_file_name,
    xmlStoragePath: row.xml_storage_path,
    pdfFileName: row.pdf_file_name,
    pdfStoragePath: row.pdf_storage_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createNfseDraft(input: {
  cnpj: string;
  templateKey: NfseTemplateKey;
  competency: string;
  tomadorLabel: string;
  issMode: string;
  referenceDay: number;
  serviceDescription: string;
  amount: number;
  status?: NfseDraftStatus;
  userId: number;
}): Promise<void> {
  await ensureCertidoesStructures();
  const normalized = normalizeCnpj(input.cnpj);
  await pool.query(
    `INSERT INTO documents_nfse_drafts (
      cnpj, template_key, competency, tomador_label, iss_mode, reference_day, service_description, amount, status, created_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
    [
      normalized,
      input.templateKey,
      input.competency.trim(),
      input.tomadorLabel.trim(),
      input.issMode.trim(),
      input.referenceDay,
      input.serviceDescription.trim(),
      input.amount,
      input.status ?? "preparada",
      input.userId,
    ],
  );
}

function extractXmlTag(xml: string, tag: string): string | null {
  const pattern = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i");
  const match = xml.match(pattern);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function extractXmlTagInside(xml: string, blockTag: string, tag: string): string | null {
  const blockPattern = new RegExp(`<(?:\\w+:)?${blockTag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${blockTag}>`, "i");
  const blockMatch = xml.match(blockPattern);
  if (!blockMatch?.[1]) return null;
  return extractXmlTag(blockMatch[1], tag);
}

function normalizeXmlDescription(value: string | null): string {
  const raw = value ?? "";
  return raw
    .replace(/\\s\\n/g, "\n")
    .replace(/\\s/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseNfseXmlPayload(xmlRaw: string): {
  invoiceNumber: string | null;
  verificationCode: string | null;
  emittedAt: string | null;
  competency: string;
  amount: number;
  description: string;
  issRetido: string | null;
  tomadorRazao: string;
  tomadorCnpj: string;
  prestadorCnpj: string;
} {
  const invoiceNumber = extractXmlTag(xmlRaw, "Numero");
  const verificationCode = extractXmlTag(xmlRaw, "CodigoVerificacao");
  const emittedAt = extractXmlTag(xmlRaw, "DataEmissao");
  const competencyDate = extractXmlTag(xmlRaw, "Competencia");
  const competency = /^\d{4}-\d{2}/.test(competencyDate ?? "") ? String(competencyDate).slice(0, 7) : monthIsoNow();
  const amountRaw = extractXmlTag(xmlRaw, "ValorServicos") ?? extractXmlTag(xmlRaw, "BaseCalculo") ?? "0";
  const amount = Number(amountRaw.replace(",", "."));
  const description = normalizeXmlDescription(extractXmlTag(xmlRaw, "Discriminacao"));
  const issRetido = extractXmlTag(xmlRaw, "IssRetido");
  const tomadorRazao = extractXmlTagInside(xmlRaw, "Tomador", "RazaoSocial") ?? "Tomador não identificado";
  const tomadorCnpj = normalizeCnpj(extractXmlTagInside(xmlRaw, "Tomador", "Cnpj") ?? "");
  const prestadorCnpj = normalizeCnpj(extractXmlTagInside(xmlRaw, "Prestador", "Cnpj") ?? extractXmlTag(xmlRaw, "Cnpj") ?? "");
  return {
    invoiceNumber,
    verificationCode,
    emittedAt,
    competency,
    amount: Number.isFinite(amount) ? amount : 0,
    description,
    issRetido,
    tomadorRazao,
    tomadorCnpj,
    prestadorCnpj,
  };
}

function monthIsoNow(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function importNfseDraftsFromXml(input: {
  cnpj?: string;
  files: Array<{ fileName: string; base64: string }>;
  userId: number;
}): Promise<{ imported: number; skipped: number }> {
  await ensureCertidoesStructures();
  const normalizedInputCnpj = normalizeCnpj(input.cnpj ?? "");
  let imported = 0;
  let skipped = 0;
  for (const file of input.files) {
    try {
      const xmlText = Buffer.from(file.base64, "base64").toString("utf8");
      const parsed = parseNfseXmlPayload(xmlText);
      const targetCnpj = normalizedInputCnpj.length === 14 ? normalizedInputCnpj : parsed.prestadorCnpj;
      if (targetCnpj.length !== 14) {
        skipped += 1;
        continue;
      }
      if (!parsed.invoiceNumber || !parsed.verificationCode || parsed.amount <= 0) {
        skipped += 1;
        continue;
      }
      if (parsed.prestadorCnpj && parsed.prestadorCnpj !== targetCnpj) {
        skipped += 1;
        continue;
      }
      const templateKey: NfseTemplateKey = parsed.issRetido === "1" ? "DIA_5_RETIDO" : "DIA_20_SEM_RETENCAO";
      const referenceDay = templateKey === "DIA_5_RETIDO" ? 5 : 20;
      const issMode = templateKey === "DIA_5_RETIDO" ? "ISS retido pelo tomador" : "Sem retenção de ISS";
      const tomadorLabel = parsed.tomadorCnpj ? `${parsed.tomadorRazao} (CNPJ: ${parsed.tomadorCnpj})` : parsed.tomadorRazao;
      const existing = await pool.query<{ id: number }>(
        `SELECT id FROM documents_nfse_drafts WHERE cnpj = $1 AND invoice_number = $2 LIMIT 1`,
        [targetCnpj, parsed.invoiceNumber],
      );
      const existingId = existing.rows[0]?.id ?? null;
      if (existingId) {
        const xmlStored = await saveNfseDraftFile({
          cnpj: targetCnpj,
          draftId: existingId,
          kind: "xml",
          fileName: file.fileName,
          base64: file.base64,
        });
        await pool.query(
          `UPDATE documents_nfse_drafts
           SET template_key = $3,
               competency = $4,
               tomador_label = $5,
               iss_mode = $6,
               reference_day = $7,
               service_description = $8,
               amount = $9,
               status = 'emitida',
               invoice_number = $10,
               verification_code = $11,
               emitted_at = COALESCE($12::timestamptz, emitted_at, NOW()),
               xml_file_name = $13,
               xml_storage_path = $14,
               updated_at = NOW()
           WHERE id = $2 AND cnpj = $1`,
          [
            targetCnpj,
            existingId,
            templateKey,
            parsed.competency,
            tomadorLabel,
            issMode,
            referenceDay,
            parsed.description || "Importado via XML",
            parsed.amount,
            parsed.invoiceNumber,
            parsed.verificationCode,
            parsed.emittedAt,
            xmlStored.fileName,
            xmlStored.storagePath,
          ],
        );
        imported += 1;
        continue;
      }
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO documents_nfse_drafts (
          cnpj, template_key, competency, tomador_label, iss_mode, reference_day, service_description, amount, status, invoice_number, verification_code, emitted_at, created_by, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'emitida', $9, $10, COALESCE($11::timestamptz, NOW()), $12, NOW())
        RETURNING id`,
        [
          targetCnpj,
          templateKey,
          parsed.competency,
          tomadorLabel,
          issMode,
          referenceDay,
          parsed.description || "Importado via XML",
          parsed.amount,
          parsed.invoiceNumber,
          parsed.verificationCode,
          parsed.emittedAt,
          input.userId,
        ],
      );
      const insertedId = inserted.rows[0]?.id;
      if (insertedId) {
        const xmlStored = await saveNfseDraftFile({
          cnpj: targetCnpj,
          draftId: insertedId,
          kind: "xml",
          fileName: file.fileName,
          base64: file.base64,
        });
        await pool.query(
          `UPDATE documents_nfse_drafts
           SET xml_file_name = $3,
               xml_storage_path = $4,
               updated_at = NOW()
           WHERE cnpj = $1 AND id = $2`,
          [targetCnpj, insertedId, xmlStored.fileName, xmlStored.storagePath],
        );
      }
      imported += 1;
    } catch {
      skipped += 1;
    }
  }
  return { imported, skipped };
}

export async function markNfseDraftAsEmitted(input: {
  id: number;
  cnpj: string;
  invoiceNumber: string;
  verificationCode: string;
  emittedAt?: string;
  xmlFile?: { fileName: string; base64: string };
  pdfFile?: { fileName: string; base64: string };
}): Promise<void> {
  await ensureCertidoesStructures();
  const normalized = normalizeCnpj(input.cnpj);
  const current = await pool.query<{
    id: number;
    xml_storage_path: string | null;
    pdf_storage_path: string | null;
  }>(
    `SELECT id, xml_storage_path, pdf_storage_path
     FROM documents_nfse_drafts
     WHERE id = $1 AND cnpj = $2`,
    [input.id, normalized],
  );
  const row = current.rows[0];
  if (!row) return;

  let xmlStored: { fileName: string; storagePath: string } | null = null;
  let pdfStored: { fileName: string; storagePath: string } | null = null;

  if (input.xmlFile?.base64?.trim()) {
    xmlStored = await saveNfseDraftFile({
      cnpj: normalized,
      draftId: input.id,
      kind: "xml",
      fileName: input.xmlFile.fileName,
      base64: input.xmlFile.base64.trim(),
    });
  }
  if (input.pdfFile?.base64?.trim()) {
    pdfStored = await saveNfseDraftFile({
      cnpj: normalized,
      draftId: input.id,
      kind: "pdf",
      fileName: input.pdfFile.fileName,
      base64: input.pdfFile.base64.trim(),
    });
  }

  await pool.query(
    `UPDATE documents_nfse_drafts
     SET status = 'emitida',
         invoice_number = $3,
         verification_code = $4,
         emitted_at = COALESCE($5::timestamptz, NOW()),
         xml_file_name = COALESCE($6, xml_file_name),
         xml_storage_path = COALESCE($7, xml_storage_path),
         pdf_file_name = COALESCE($8, pdf_file_name),
         pdf_storage_path = COALESCE($9, pdf_storage_path),
         updated_at = NOW()
     WHERE id = $1 AND cnpj = $2`,
    [
      input.id,
      normalized,
      input.invoiceNumber.trim(),
      input.verificationCode.trim(),
      input.emittedAt?.trim() || null,
      xmlStored?.fileName ?? null,
      xmlStored?.storagePath ?? null,
      pdfStored?.fileName ?? null,
      pdfStored?.storagePath ?? null,
    ],
  );
}

export async function getNfseDraftAttachmentPath(input: {
  id: number;
  cnpj: string;
  kind: "xml" | "pdf";
}): Promise<string | null> {
  await ensureCertidoesStructures();
  const normalized = normalizeCnpj(input.cnpj);
  const column = input.kind === "xml" ? "xml_storage_path" : "pdf_storage_path";
  const result = await pool.query<{ storage_path: string | null }>(
    `SELECT ${column} AS storage_path
     FROM documents_nfse_drafts
     WHERE id = $1 AND cnpj = $2`,
    [input.id, normalized],
  );
  return result.rows[0]?.storage_path ?? null;
}

export async function upsertMonthlyObligation(input: {
  cnpj: string;
  obligationType: MonthlyObligationType;
  competency: string;
  uploadMode: MonthlyUploadMode;
  singleFile?: { fileName: string; base64: string } | null;
  boletoFile?: { fileName: string; base64: string } | null;
  receiptFile?: { fileName: string; base64: string } | null;
  userId: number;
}): Promise<void> {
  await ensureCertidoesStructures();
  const normalizedCnpj = normalizeCnpj(input.cnpj);
  const competency = input.competency.trim();

  let singleStored: { fileName: string; storagePath: string; fileHash: string } | null = null;
  let boletoStored: { fileName: string; storagePath: string; fileHash: string } | null = null;
  let receiptStored: { fileName: string; storagePath: string; fileHash: string } | null = null;

  if (input.singleFile?.base64?.trim()) {
    singleStored = await saveMonthlyFile({
      cnpj: normalizedCnpj,
      obligationType: input.obligationType,
      competency,
      kind: "single",
      fileName: input.singleFile.fileName,
      base64: input.singleFile.base64.trim(),
    });
  }
  if (input.boletoFile?.base64?.trim()) {
    boletoStored = await saveMonthlyFile({
      cnpj: normalizedCnpj,
      obligationType: input.obligationType,
      competency,
      kind: "boleto",
      fileName: input.boletoFile.fileName,
      base64: input.boletoFile.base64.trim(),
    });
  }
  if (input.receiptFile?.base64?.trim()) {
    receiptStored = await saveMonthlyFile({
      cnpj: normalizedCnpj,
      obligationType: input.obligationType,
      competency,
      kind: "receipt",
      fileName: input.receiptFile.fileName,
      base64: input.receiptFile.base64.trim(),
    });
  }

  await pool.query(
    `INSERT INTO documents_monthly_obligations (
      cnpj, obligation_type, competency, upload_mode, single_file_name, single_storage_path, single_file_hash, boleto_file_name, boleto_storage_path, boleto_file_hash, receipt_file_name, receipt_storage_path, receipt_file_hash, updated_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    ON CONFLICT (cnpj, obligation_type, competency) DO UPDATE SET
      upload_mode = EXCLUDED.upload_mode,
      single_file_name = COALESCE(EXCLUDED.single_file_name, documents_monthly_obligations.single_file_name),
      single_storage_path = COALESCE(EXCLUDED.single_storage_path, documents_monthly_obligations.single_storage_path),
      single_file_hash = COALESCE(EXCLUDED.single_file_hash, documents_monthly_obligations.single_file_hash),
      boleto_file_name = COALESCE(EXCLUDED.boleto_file_name, documents_monthly_obligations.boleto_file_name),
      boleto_storage_path = COALESCE(EXCLUDED.boleto_storage_path, documents_monthly_obligations.boleto_storage_path),
      boleto_file_hash = COALESCE(EXCLUDED.boleto_file_hash, documents_monthly_obligations.boleto_file_hash),
      receipt_file_name = COALESCE(EXCLUDED.receipt_file_name, documents_monthly_obligations.receipt_file_name),
      receipt_storage_path = COALESCE(EXCLUDED.receipt_storage_path, documents_monthly_obligations.receipt_storage_path),
      receipt_file_hash = COALESCE(EXCLUDED.receipt_file_hash, documents_monthly_obligations.receipt_file_hash),
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`,
    [
      normalizedCnpj,
      input.obligationType,
      competency,
      input.uploadMode,
      singleStored?.fileName ?? null,
      singleStored?.storagePath ?? null,
      singleStored?.fileHash ?? null,
      boletoStored?.fileName ?? null,
      boletoStored?.storagePath ?? null,
      boletoStored?.fileHash ?? null,
      receiptStored?.fileName ?? null,
      receiptStored?.storagePath ?? null,
      receiptStored?.fileHash ?? null,
      input.userId,
    ],
  );
}

export async function getMonthlyObligationDownloadPath(input: {
  cnpj: string;
  obligationType: MonthlyObligationType;
  competency: string;
  kind: "single" | "boleto" | "receipt";
}): Promise<string | null> {
  await ensureCertidoesStructures();
  const normalized = normalizeCnpj(input.cnpj);
  const column =
    input.kind === "single"
      ? "single_storage_path"
      : input.kind === "boleto"
        ? "boleto_storage_path"
        : "receipt_storage_path";
  const result = await pool.query<{ storage_path: string | null }>(
    `SELECT ${column} AS storage_path
     FROM documents_monthly_obligations
     WHERE cnpj = $1 AND obligation_type = $2 AND competency = $3`,
    [normalized, input.obligationType, input.competency],
  );
  const filePath = result.rows[0]?.storage_path ?? null;
  if (!filePath) return null;
  return (await pathExists(filePath)) ? filePath : null;
}

export async function getMonthlyObligationCombinedPdf(input: {
  cnpj: string;
  obligationType: MonthlyObligationType;
  competency: string;
}): Promise<{ fileName: string; buffer: Buffer } | null> {
  await ensureCertidoesStructures();
  const normalized = normalizeCnpj(input.cnpj);
  const result = await pool.query<{
    single_storage_path: string | null;
    boleto_storage_path: string | null;
    receipt_storage_path: string | null;
  }>(
    `SELECT single_storage_path, boleto_storage_path, receipt_storage_path
     FROM documents_monthly_obligations
     WHERE cnpj = $1 AND obligation_type = $2 AND competency = $3`,
    [normalized, input.obligationType, input.competency],
  );
  const row = result.rows[0];
  if (!row?.single_storage_path && !row?.boleto_storage_path && !row?.receipt_storage_path) return null;

  const outputPdf = await PDFDocument.create();

  const appendFile = async (filePath: string) => {
    if (!(await pathExists(filePath))) return;
    const bytes = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".pdf") {
      const sourcePdf = await PDFDocument.load(bytes);
      const copiedPages = await outputPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
      copiedPages.forEach((page) => outputPdf.addPage(page));
      return;
    }
    if (ext === ".png") {
      const image = await outputPdf.embedPng(bytes);
      const page = outputPdf.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      return;
    }
    if (ext === ".jpg" || ext === ".jpeg") {
      const image = await outputPdf.embedJpg(bytes);
      const page = outputPdf.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      return;
    }
    throw new Error("Formato de arquivo não suportado para composição PDF.");
  };

  if (row.single_storage_path) await appendFile(row.single_storage_path);
  if (row.boleto_storage_path) await appendFile(row.boleto_storage_path);
  if (row.receipt_storage_path) await appendFile(row.receipt_storage_path);
  if (outputPdf.getPageCount() === 0) return null;

  const mergedBytes = await outputPdf.save();
  return {
    fileName: `${normalized}-${input.obligationType}-${input.competency}-boleto-comprovante.pdf`,
    buffer: Buffer.from(mergedBytes),
  };
}

export async function deleteMonthlyObligation(input: {
  cnpj: string;
  obligationType: MonthlyObligationType;
  competency: string;
}): Promise<void> {
  await ensureCertidoesStructures();
  const normalized = normalizeCnpj(input.cnpj);
  const existing = await pool.query<{
    single_storage_path: string | null;
    boleto_storage_path: string | null;
    receipt_storage_path: string | null;
  }>(
    `SELECT single_storage_path, boleto_storage_path, receipt_storage_path
     FROM documents_monthly_obligations
     WHERE cnpj = $1 AND obligation_type = $2 AND competency = $3`,
    [normalized, input.obligationType, input.competency],
  );
  const row = existing.rows[0];
  await pool.query(
    `DELETE FROM documents_monthly_obligations
     WHERE cnpj = $1 AND obligation_type = $2 AND competency = $3`,
    [normalized, input.obligationType, input.competency],
  );
  if (!row) return;
  const paths = [row.single_storage_path, row.boleto_storage_path, row.receipt_storage_path].filter(
    (value): value is string => Boolean(value),
  );
  for (const filePath of paths) {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignora falha de remoção física para não quebrar operação principal
    }
  }
}

export async function getDefaultCnpj(): Promise<string | null> {
  await ensureCertidoesStructures();
  const result = await pool.query<{ cnpj: string }>(`SELECT cnpj FROM documents_certificate_config ORDER BY id ASC LIMIT 1`);
  return result.rows[0]?.cnpj ?? null;
}
