import { createServer } from "http";
import { app } from "./app";
import { env } from "./config/env";
import { pool } from "./db/pool";
import { setupSocket } from "./realtime/socket";

async function bootstrap(): Promise<void> {
  await pool.query("SELECT 1");

  const server = createServer(app);
  setupSocket(server);

  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API rodando na porta ${env.PORT}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha ao iniciar API:", err);
  process.exit(1);
});
