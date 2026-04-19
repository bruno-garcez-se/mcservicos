import { Pool } from "pg";
import { env } from "../config/env";

const normalizedUrl = env.DATABASE_URL.toLowerCase();
const useSsl =
  normalizedUrl.includes("render.com") ||
  normalizedUrl.includes("sslmode=require") ||
  normalizedUrl.includes("supabase.co");

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});
