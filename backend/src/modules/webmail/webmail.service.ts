import { pool } from "../../db/pool";
import { decryptSecret, encryptSecret } from "../../utils/crypto";

export type WebmailConfig = {
  roundcubeUrl: string;
  smtpHost: string;
  smtpPort: string;
  imapHost: string;
  imapPort: string;
  login: string;
  password: string;
  updatedAt: string | null;
};

type RawWebmailRow = {
  roundcube_url: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  imap_host: string | null;
  imap_port: number | null;
  login_encrypted: string | null;
  password_encrypted: string | null;
  updated_at: string | null;
};

function decryptMaybe(value: string | null): string {
  if (!value) return "";
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}

function toResponse(row: RawWebmailRow | null): WebmailConfig {
  if (!row) {
    return {
      roundcubeUrl: "",
      smtpHost: "",
      smtpPort: "",
      imapHost: "",
      imapPort: "",
      login: "",
      password: "",
      updatedAt: null,
    };
  }

  return {
    roundcubeUrl: row.roundcube_url ?? "",
    smtpHost: row.smtp_host ?? "",
    smtpPort: row.smtp_port ? String(row.smtp_port) : "",
    imapHost: row.imap_host ?? "",
    imapPort: row.imap_port ? String(row.imap_port) : "",
    login: decryptMaybe(row.login_encrypted),
    password: decryptMaybe(row.password_encrypted),
    updatedAt: row.updated_at,
  };
}

export async function getWebmailConfig(): Promise<WebmailConfig> {
  const result = await pool.query(
    `SELECT roundcube_url, smtp_host, smtp_port, imap_host, imap_port, login_encrypted, password_encrypted, updated_at
     FROM webmail_settings
     WHERE id = 1`,
  );
  const row = (result.rows[0] ?? null) as RawWebmailRow | null;
  return toResponse(row);
}

export async function saveWebmailConfig(input: {
  roundcubeUrl: string;
  smtpHost: string;
  smtpPort: number | null;
  imapHost: string;
  imapPort: number | null;
  login: string;
  password: string;
  actorUserId: number;
}): Promise<WebmailConfig> {
  await pool.query(
    `INSERT INTO webmail_settings (
      id,
      roundcube_url,
      smtp_host,
      smtp_port,
      imap_host,
      imap_port,
      login_encrypted,
      password_encrypted,
      updated_by
    )
    VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id)
    DO UPDATE SET
      roundcube_url = EXCLUDED.roundcube_url,
      smtp_host = EXCLUDED.smtp_host,
      smtp_port = EXCLUDED.smtp_port,
      imap_host = EXCLUDED.imap_host,
      imap_port = EXCLUDED.imap_port,
      login_encrypted = EXCLUDED.login_encrypted,
      password_encrypted = EXCLUDED.password_encrypted,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`,
    [
      input.roundcubeUrl,
      input.smtpHost,
      input.smtpPort,
      input.imapHost,
      input.imapPort,
      encryptSecret(input.login),
      encryptSecret(input.password),
      input.actorUserId,
    ],
  );

  return getWebmailConfig();
}
import { pool } from "../../db/pool";
import { decryptSecret, encryptSecret } from "../../utils/crypto";

export type WebmailConfig = {
  roundcubeUrl: string;
  smtpHost: string;
  smtpPort: string;
  imapHost: string;
  imapPort: string;
  login: string;
  password: string;
  updatedAt: string | null;
};

type RawWebmailRow = {
  roundcube_url: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  imap_host: string | null;
  imap_port: number | null;
  login_encrypted: string | null;
  password_encrypted: string | null;
  updated_at: string | null;
};

function decryptMaybe(value: string | null): string {
  if (!value) return "";
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}

function toResponse(row: RawWebmailRow | null): WebmailConfig {
  if (!row) {
    return {
      roundcubeUrl: "",
      smtpHost: "",
      smtpPort: "",
      imapHost: "",
      imapPort: "",
      login: "",
      password: "",
      updatedAt: null,
    };
  }

  return {
    roundcubeUrl: row.roundcube_url ?? "",
    smtpHost: row.smtp_host ?? "",
    smtpPort: row.smtp_port ? String(row.smtp_port) : "",
    imapHost: row.imap_host ?? "",
    imapPort: row.imap_port ? String(row.imap_port) : "",
    login: decryptMaybe(row.login_encrypted),
    password: decryptMaybe(row.password_encrypted),
    updatedAt: row.updated_at,
  };
}

export async function getWebmailConfig(): Promise<WebmailConfig> {
  const result = await pool.query(
    `SELECT roundcube_url, smtp_host, smtp_port, imap_host, imap_port, login_encrypted, password_encrypted, updated_at
     FROM webmail_settings
     WHERE id = 1`,
  );
  const row = (result.rows[0] ?? null) as RawWebmailRow | null;
  return toResponse(row);
}

export async function saveWebmailConfig(input: {
  roundcubeUrl: string;
  smtpHost: string;
  smtpPort: number | null;
  imapHost: string;
  imapPort: number | null;
  login: string;
  password: string;
  actorUserId: number;
}): Promise<WebmailConfig> {
  await pool.query(
    `INSERT INTO webmail_settings (
      id,
      roundcube_url,
      smtp_host,
      smtp_port,
      imap_host,
      imap_port,
      login_encrypted,
      password_encrypted,
      updated_by
    )
    VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id)
    DO UPDATE SET
      roundcube_url = EXCLUDED.roundcube_url,
      smtp_host = EXCLUDED.smtp_host,
      smtp_port = EXCLUDED.smtp_port,
      imap_host = EXCLUDED.imap_host,
      imap_port = EXCLUDED.imap_port,
      login_encrypted = EXCLUDED.login_encrypted,
      password_encrypted = EXCLUDED.password_encrypted,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`,
    [
      input.roundcubeUrl,
      input.smtpHost,
      input.smtpPort,
      input.imapHost,
      input.imapPort,
      encryptSecret(input.login),
      encryptSecret(input.password),
      input.actorUserId,
    ],
  );

  return getWebmailConfig();
}
