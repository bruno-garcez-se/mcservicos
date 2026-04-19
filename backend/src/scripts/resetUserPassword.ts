import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { config } from "dotenv";

config();

const databaseUrl =
  process.env.TARGET_DATABASE_URL ?? process.env.RENDER_DATABASE_URL ?? process.env.DATABASE_URL;
const email = process.argv[2];
const newPassword = process.argv[3];

if (!databaseUrl) {
  throw new Error("DATABASE_URL/TARGET_DATABASE_URL nao definido.");
}

if (!email || !newPassword) {
  throw new Error("Uso: tsx src/scripts/resetUserPassword.ts <email> <nova_senha>");
}

const ssl =
  databaseUrl.includes("render.com") || databaseUrl.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined;

const pool = new Pool({
  connectionString: databaseUrl,
  ssl,
});

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, 10);

  const result = await pool.query(
    `UPDATE users
     SET password_hash = $1, active = TRUE
     WHERE email = $2
     RETURNING id, email, role, active`,
    [passwordHash, email],
  );

  if (result.rows.length === 0) {
    throw new Error(`Usuario nao encontrado: ${email}`);
  }

  // eslint-disable-next-line no-console
  console.log("Senha atualizada com sucesso.");
  // eslint-disable-next-line no-console
  console.log(result.rows[0]);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Erro ao resetar senha:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
