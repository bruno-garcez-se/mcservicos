import { pool } from "../../db/pool";

let ensureColumnsPromise: Promise<void> | null = null;

export async function ensureUserMenuVisibilityColumns(): Promise<void> {
  if (!ensureColumnsPromise) {
    ensureColumnsPromise = (async () => {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_senhas BOOLEAN NOT NULL DEFAULT TRUE`);
      await pool.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_transacional BOOLEAN NOT NULL DEFAULT TRUE`,
      );
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_negocial BOOLEAN NOT NULL DEFAULT TRUE`);
    })();
  }

  try {
    await ensureColumnsPromise;
  } catch (error) {
    ensureColumnsPromise = null;
    throw error;
  }
}
