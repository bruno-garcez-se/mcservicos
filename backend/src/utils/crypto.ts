import crypto from "crypto";
import { env } from "../config/env";

const ALGO = "aes-256-gcm";
const KEY = crypto
  .createHash("sha256")
  .update(env.CREDENTIAL_ENCRYPTION_KEY)
  .digest();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString(
    "base64",
  )}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, encryptedB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Formato de senha criptografada invalido.");
  }

  const decipher = crypto.createDecipheriv(
    ALGO,
    KEY,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const plain = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
