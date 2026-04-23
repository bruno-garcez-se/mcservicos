import path from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: path.resolve(process.cwd(), ".env") });

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
  const reason = marginMatch ? withoutPrefix.slice(0, marginMatch.index).trim() || null : withoutPrefix || null;
  return { reason, hasMargin };
}

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não encontrado.");

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
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

    let inserted = 0;
    for (const client of missingClients.rows) {
      const lossNote = await pool.query<{ notes: string }>(
        `SELECT notes
         FROM loan_interactions
         WHERE client_id = $1
           AND notes ILIKE 'Motivo da perda:%'
         ORDER BY created_at DESC
         LIMIT 1`,
        [client.id],
      );
      const parsedLoss = parseLossNote(lossNote.rows[0]?.notes ?? null);
      const isTerminal = client.status === "ganho" || client.status === "perdido";
      const outcome = client.status === "ganho" || client.status === "perdido" ? client.status : null;
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
          outcome,
          parsedLoss.reason,
          parsedLoss.hasMargin,
          client.created_by,
          client.created_at,
        ],
      );
      inserted += 1;
    }

    process.stdout.write(`Oportunidades retroativas inseridas: ${inserted}\n`);
  } finally {
    await pool.end();
  }
}

void run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
