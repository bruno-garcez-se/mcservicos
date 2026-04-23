import fs from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: path.resolve(process.cwd(), ".env") });

function timestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definido.");
  }

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const stamp = timestamp();
  const backupDir = path.resolve(process.cwd(), "..", "backups");
  const backupPath = path.resolve(backupDir, `db_snapshot_${stamp}.json`);

  await fs.mkdir(backupDir, { recursive: true });

  try {
    const tablesRes = await pool.query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`,
    );

    const tables = tablesRes.rows.map((row) => row.tablename);
    const payload: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      database: "public",
      tables: {} as Record<string, unknown[]>,
    };

    for (const table of tables) {
      const rowsRes = await pool.query(`SELECT * FROM "${table}"`);
      (payload.tables as Record<string, unknown[]>)[table] = rowsRes.rows;
    }

    await fs.writeFile(backupPath, JSON.stringify(payload, null, 2), "utf8");
    process.stdout.write(`Backup salvo em: ${backupPath}\n`);
    process.stdout.write(`Total de tabelas: ${tables.length}\n`);
  } finally {
    await pool.end();
  }
}

void run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
