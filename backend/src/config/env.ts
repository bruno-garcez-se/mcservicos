import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3333),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  FRONTEND_URLS: z.string().optional(),
  TRANSPARENCIA_BASE_URL: z.string().url().default("https://api.transparencia.se.gov.br"),
  TRANSPARENCIA_CONSULTAR_PATH: z
    .string()
    .default("/api/recursos-humanos/folha-pagamento"),
  TRANSPARENCIA_DETALHAR_PATH: z
    .string()
    .default("/api/recursos-humanos/remuneracao-servidores-ativos/contracheque"),
  TRANSPARENCIA_COOKIE: z.string().optional(),
  TRANSPARENCIA_HEADERS_JSON: z.string().optional(),
  VPN_CONNECTION_NAME: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(32),
  CERTIDOES_INFOSIMPLES_TOKEN: z.string().optional(),
  CERTIDOES_MOCK_MODE: z.enum(["true", "false"]).optional(),
  CERTIDOES_FORCE_RUNNER: z.enum(["backend", "agent"]).optional(),
  CERTIDOES_AUTO_REFRESH_ENABLED: z.enum(["true", "false"]).optional(),
  CERTIDOES_EXPIRING_WINDOW_DAYS: z.coerce.number().optional(),
  CERTIDOES_SCHEDULER_INTERVAL_MS: z.coerce.number().optional(),
  CERTIDOES_PLAYWRIGHT_TIMEOUT_MS: z.coerce.number().optional(),
});

export const env = envSchema.parse(process.env);
