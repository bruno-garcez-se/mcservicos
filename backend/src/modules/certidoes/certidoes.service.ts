import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import forge from "node-forge";
import { pool } from "../../db/pool";
import {
  CertidaoRecord,
  CertidaoStatus,
  CertidaoTipo,
  CertificateConfigRecord,
  RunnerMode,
} from "./certidoes.types";
import { CndtProvider } from "./providers/cndt.provider";
import { CnfProvider } from "./providers/cnf.provider";
import { CrfProvider } from "./providers/crf.provider";
import { BackendRunner } from "./runners/backend.runner";
import { AgentRunner } from "./runners/agent.runner";

const CERT_TYPES: CertidaoTipo[] = ["CNDT", "CNF", "CRF"];
const EXPIRING_WINDOW_DAYS = Number(process.env.CERTIDOES_EXPIRING_WINDOW_DAYS || 7);
const CERT_STORAGE_ROOT = path.resolve(process.cwd(), "storage", "certidoes");
const AGENT_BASE_URL = (process.env.VPN_AGENT_URL || "http://127.0.0.1:48321").replace(/\/+$/, "");

const providers = {
  CNDT: new CndtProvider(),
  CNF: new CnfProvider(),
  CRF: new CrfProvider(),
} as const;

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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_certidoes_status ON documents_certidoes(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_certidoes_expiry ON documents_certidoes(expiry_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_certidoes_checked ON documents_certidoes(last_checked_at);`);
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

function selectRunner(mode: RunnerMode) {
  if (mode === "agent") return new AgentRunner();
  return new BackendRunner();
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
  return result.rows[0]?.storage_path ?? null;
}

export async function getDefaultCnpj(): Promise<string | null> {
  await ensureCertidoesStructures();
  const result = await pool.query<{ cnpj: string }>(`SELECT cnpj FROM documents_certificate_config ORDER BY id ASC LIMIT 1`);
  return result.rows[0]?.cnpj ?? null;
}
