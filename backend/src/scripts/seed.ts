import bcrypt from "bcryptjs";
import { pool } from "../db/pool";
import { encryptSecret } from "../utils/crypto";

async function main(): Promise<void> {
  const adminPassword = await bcrypt.hash("Admin@123", 10);
  const employeePassword = await bcrypt.hash("Func@123", 10);

  await pool.query(
    `INSERT INTO groups (name)
     VALUES ('Gerente'), ('Atendente')
     ON CONFLICT (name) DO NOTHING`,
  );

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES
       ('Administrador', 'admin@empresa.com', $1, 'admin'),
       ('Funcionario Financeiro', 'financeiro@empresa.com', $2, 'employee')
     ON CONFLICT (email) DO NOTHING`,
    [adminPassword, employeePassword],
  );

  await pool.query(
    `INSERT INTO user_groups (user_id, group_id)
     SELECT u.id, g.id
     FROM users u
     JOIN groups g ON g.name = 'Gerente'
     WHERE u.email = 'financeiro@empresa.com'
     ON CONFLICT DO NOTHING`,
  );

  const adminResult = await pool.query(
    `SELECT id FROM users WHERE email = 'admin@empresa.com' LIMIT 1`,
  );
  const adminId = adminResult.rows[0]?.id as number | undefined;
  const financeiroResult = await pool.query(
    `SELECT id FROM groups WHERE name = 'Gerente' LIMIT 1`,
  );
  const financeiroGroupId = financeiroResult.rows[0]?.id as number | undefined;

  if (adminId && financeiroGroupId) {
    const credentialResult = await pool.query(
      `INSERT INTO credentials (system_name, username, password_encrypted, updated_by)
       VALUES ('ERP Principal', 'financeiro@empresa.com', $1, $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [encryptSecret("Senha@123"), adminId],
    );

    const credentialId = credentialResult.rows[0]?.id as number | undefined;
    if (credentialId) {
      await pool.query(
        `INSERT INTO credential_groups (credential_id, group_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [credentialId, financeiroGroupId],
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log("Seed concluido.");
  // eslint-disable-next-line no-console
  console.log("Admin: admin@empresa.com / Admin@123");
  // eslint-disable-next-line no-console
  console.log("Funcionario: financeiro@empresa.com / Func@123");
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Erro no seed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
