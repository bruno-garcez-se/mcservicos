import { pool } from "../db/pool";
import { schemaSql } from "../db/schema";

async function main(): Promise<void> {
  await pool.query(schemaSql);
  // eslint-disable-next-line no-console
  console.log("Schema criado/validado com sucesso.");
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Erro ao inicializar schema:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
