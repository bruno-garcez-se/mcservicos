import { config } from "dotenv";
import { Pool, type QueryResultRow } from "pg";
import { schemaSql } from "../db/schema";

config();

type Serializable =
  | string
  | number
  | boolean
  | null
  | Date
  | Record<string, unknown>
  | unknown[];

const SOURCE_DATABASE_URL =
  process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
const TARGET_DATABASE_URL =
  process.env.TARGET_DATABASE_URL ?? process.env.RENDER_DATABASE_URL;
const MIGRATION_CONFIRM = process.env.MIGRATION_CONFIRM;
const args = process.argv.slice(2);
const confirmedByArg = args.includes("--confirm");

function getSslConfig(databaseUrl: string): { rejectUnauthorized: false } | undefined {
  const normalized = databaseUrl.toLowerCase();
  if (
    normalized.includes("render.com") ||
    normalized.includes("sslmode=require") ||
    normalized.includes("supabase.co")
  ) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

function createPool(databaseUrl: string): Pool {
  const ssl = getSslConfig(databaseUrl);
  return new Pool({
    connectionString: databaseUrl,
    ssl,
  });
}

async function selectAll<T extends QueryResultRow>(
  pool: Pool,
  table: string,
  orderBy: string,
): Promise<T[]> {
  const query = `SELECT * FROM ${table} ORDER BY ${orderBy}`;
  const result = await pool.query<T>(query);
  return result.rows;
}

async function insertRows(
  pool: Pool,
  table: string,
  columns: string[],
  rows: QueryResultRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  for (const row of rows) {
    const values = columns.map((column) => {
      const value = row[column] as Serializable;
      if (column !== "extra_fields" && column !== "details") {
        return value;
      }

      if (value === null) {
        return null;
      }

      if (typeof value === "string") {
        try {
          return JSON.stringify(JSON.parse(value));
        } catch {
          return JSON.stringify(value);
        }
      }

      return JSON.stringify(value);
    });
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    const query = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
    await pool.query(query, values);
  }
}

async function setSequence(pool: Pool, sequenceName: string, table: string): Promise<void> {
  await pool.query(
    `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) > 0 FROM ${table}))`,
    [sequenceName],
  );
}

async function main(): Promise<void> {
  if (!SOURCE_DATABASE_URL) {
    throw new Error("SOURCE_DATABASE_URL (ou DATABASE_URL) nao foi definido.");
  }

  if (!TARGET_DATABASE_URL) {
    throw new Error("TARGET_DATABASE_URL nao foi definido.");
  }

  if (SOURCE_DATABASE_URL === TARGET_DATABASE_URL) {
    throw new Error("SOURCE_DATABASE_URL e TARGET_DATABASE_URL nao podem ser iguais.");
  }

  if (MIGRATION_CONFIRM !== "SIM" && !confirmedByArg) {
    throw new Error(
      "Confirmacao obrigatoria ausente. Defina MIGRATION_CONFIRM=SIM ou use --confirm.",
    );
  }

  const sourcePool = createPool(SOURCE_DATABASE_URL);
  const targetPool = createPool(TARGET_DATABASE_URL);

  try {
    // Garante que o destino tenha o schema atualizado antes da copia.
    await targetPool.query(schemaSql);

    const users = await selectAll(sourcePool, "users", "id");
    const groups = await selectAll(sourcePool, "groups", "id");
    const userGroups = await selectAll(sourcePool, "user_groups", "user_id, group_id");
    const credentials = await selectAll(sourcePool, "credentials", "id");
    const credentialGroups = await selectAll(
      sourcePool,
      "credential_groups",
      "credential_id, group_id",
    );
    const auditLogs = await selectAll(sourcePool, "audit_logs", "id");

    await targetPool.query("BEGIN");
    await targetPool.query(
      "TRUNCATE TABLE audit_logs, credential_groups, user_groups, credentials, groups, users RESTART IDENTITY CASCADE",
    );

    await insertRows(
      targetPool,
      "users",
      ["id", "name", "email", "password_hash", "role", "active", "created_at"],
      users,
    );
    await insertRows(targetPool, "groups", ["id", "name", "created_at"], groups);
    await insertRows(targetPool, "user_groups", ["user_id", "group_id"], userGroups);
    await insertRows(
      targetPool,
      "credentials",
      [
        "id",
        "system_name",
        "link_url",
        "username",
        "password_encrypted",
        "extra_fields",
        "updated_by",
        "created_at",
        "updated_at",
      ],
      credentials,
    );
    await insertRows(
      targetPool,
      "credential_groups",
      ["credential_id", "group_id"],
      credentialGroups,
    );
    await insertRows(
      targetPool,
      "audit_logs",
      ["id", "actor_user_id", "action", "target_type", "target_id", "details", "created_at"],
      auditLogs,
    );

    await setSequence(targetPool, "users_id_seq", "users");
    await setSequence(targetPool, "groups_id_seq", "groups");
    await setSequence(targetPool, "credentials_id_seq", "credentials");
    await setSequence(targetPool, "audit_logs_id_seq", "audit_logs");

    await targetPool.query("COMMIT");

    // eslint-disable-next-line no-console
    console.log("Migracao concluida com sucesso.");
    // eslint-disable-next-line no-console
    console.log(`Usuarios: ${users.length}`);
    // eslint-disable-next-line no-console
    console.log(`Grupos: ${groups.length}`);
    // eslint-disable-next-line no-console
    console.log(`Credenciais: ${credentials.length}`);
    // eslint-disable-next-line no-console
    console.log(`Logs de auditoria: ${auditLogs.length}`);
  } catch (error) {
    await targetPool.query("ROLLBACK");
    throw error;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Erro na migracao:", err);
  process.exit(1);
});
