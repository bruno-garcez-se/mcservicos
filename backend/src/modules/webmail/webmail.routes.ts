import { Router } from "express";
import nodemailer from "nodemailer";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { getWebmailConfig, saveWebmailConfig } from "./webmail.service";
import { pool } from "../../db/pool";

const webmailRouter = Router();

const nullablePortSchema = z
  .union([z.number().int(), z.string().trim(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return value;
    return Number(value);
  })
  .refine(
    (value) =>
      value === null || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535),
    "Porta inválida. Informe um número entre 1 e 65535.",
  );

const payloadSchema = z.object({
  roundcubeUrl: z.string().trim().url().or(z.literal("")),
  smtpHost: z.string().trim().default(""),
  smtpPort: nullablePortSchema,
  imapHost: z.string().trim().default(""),
  imapPort: nullablePortSchema,
  login: z.string().trim().default(""),
  password: z.string().default(""),
});

const testSchema = z.object({
  to: z.string().trim().email().max(200).optional(),
  smtpHost: z.string().trim().optional(),
  smtpPort: z.union([z.string(), z.number()]).optional(),
  login: z.string().trim().optional(),
  password: z.string().optional(),
});

webmailRouter.get("/config", requireAuth, requireRole("admin"), async (_req, res) => {
  const config = await getWebmailConfig();
  res.json(config);
});

webmailRouter.put("/config", requireAuth, requireRole("admin"), async (req, res) => {
  const payload = payloadSchema.parse(req.body);
  const saved = await saveWebmailConfig({
    ...payload,
    actorUserId: req.user!.id,
  });
  res.json(saved);
});

webmailRouter.post("/config/test", requireAuth, requireRole("admin"), async (req, res) => {
  const payload = testSchema.parse(req.body ?? {});
  const config = await getWebmailConfig();

  const smtpHost = String(payload.smtpHost ?? config.smtpHost ?? "").trim();
  const smtpPortRaw = String(payload.smtpPort ?? config.smtpPort ?? "").trim();
  const login = String(payload.login ?? config.login ?? "").trim();
  const password = String(payload.password ?? config.password ?? "");

  if (!smtpHost || !login || !password) {
    res.status(400).json({
      message: "Preencha Host SMTP, Login e Senha para enviar o teste.",
    });
    return;
  }

  const smtpPort = Number(smtpPortRaw || "587");
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    res.status(400).json({
      message: "Porta SMTP inválida. Informe um número entre 1 e 65535.",
    });
    return;
  }

  const userResult = await pool.query<{ email: string | null }>(
    `SELECT email FROM users WHERE id = $1 LIMIT 1`,
    [req.user!.id],
  );
  const fallbackTo = String(userResult.rows[0]?.email || "").trim();
  const to = String(payload.to || fallbackTo || "").trim();
  if (!to) {
    res.status(400).json({
      message: "Informe o e-mail de destino para teste.",
    });
    return;
  }

  try {
    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: login,
        pass: password,
      },
    });
    await transport.verify();
    await transport.sendMail({
      from: login,
      to,
      subject: "[MC Serviços] Teste de configuração de e-mail",
      text:
        "Este é um e-mail de teste enviado pelo MC Serviços.\n\n" +
        `Host SMTP: ${smtpHost}\n` +
        `Porta SMTP: ${smtpPort}\n` +
        `Data/Hora: ${new Date().toLocaleString("pt-BR")}\n`,
      html:
        `<p>Este é um e-mail de teste enviado pelo <strong>MC Serviços</strong>.</p>` +
        `<p><strong>Host SMTP:</strong> ${smtpHost}<br/>` +
        `<strong>Porta SMTP:</strong> ${smtpPort}<br/>` +
        `<strong>Data/Hora:</strong> ${new Date().toLocaleString("pt-BR")}</p>`,
    });
    res.json({
      ok: true,
      message: `E-mail de teste enviado para ${to}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao enviar e-mail de teste.";
    res.status(400).json({
      message: `Falha ao enviar teste: ${message}`,
    });
  }
});

export { webmailRouter };
import { Router } from "express";
import nodemailer from "nodemailer";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { getWebmailConfig, saveWebmailConfig } from "./webmail.service";
import { pool } from "../../db/pool";

const webmailRouter = Router();

const nullablePortSchema = z
  .union([z.number().int(), z.string().trim(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return value;
    return Number(value);
  })
  .refine(
    (value) =>
      value === null || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535),
    "Porta inválida. Informe um número entre 1 e 65535.",
  );

const payloadSchema = z.object({
  roundcubeUrl: z.string().trim().url().or(z.literal("")),
  smtpHost: z.string().trim().default(""),
  smtpPort: nullablePortSchema,
  imapHost: z.string().trim().default(""),
  imapPort: nullablePortSchema,
  login: z.string().trim().default(""),
  password: z.string().default(""),
});

const testSchema = z.object({
  to: z.string().trim().email().max(200).optional(),
  smtpHost: z.string().trim().optional(),
  smtpPort: z.union([z.string(), z.number()]).optional(),
  login: z.string().trim().optional(),
  password: z.string().optional(),
});

webmailRouter.get("/config", requireAuth, requireRole("admin"), async (_req, res) => {
  const config = await getWebmailConfig();
  res.json(config);
});

webmailRouter.put("/config", requireAuth, requireRole("admin"), async (req, res) => {
  const payload = payloadSchema.parse(req.body);
  const saved = await saveWebmailConfig({
    ...payload,
    actorUserId: req.user!.id,
  });
  res.json(saved);
});

webmailRouter.post("/config/test", requireAuth, requireRole("admin"), async (req, res) => {
  const payload = testSchema.parse(req.body ?? {});
  const config = await getWebmailConfig();

  const smtpHost = String(payload.smtpHost ?? config.smtpHost ?? "").trim();
  const smtpPortRaw = String(payload.smtpPort ?? config.smtpPort ?? "").trim();
  const login = String(payload.login ?? config.login ?? "").trim();
  const password = String(payload.password ?? config.password ?? "");

  if (!smtpHost || !login || !password) {
    res.status(400).json({
      message: "Preencha Host SMTP, Login e Senha para enviar o teste.",
    });
    return;
  }

  const smtpPort = Number(smtpPortRaw || "587");
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    res.status(400).json({
      message: "Porta SMTP inválida. Informe um número entre 1 e 65535.",
    });
    return;
  }

  const userResult = await pool.query<{ email: string | null }>(
    `SELECT email FROM users WHERE id = $1 LIMIT 1`,
    [req.user!.id],
  );
  const fallbackTo = String(userResult.rows[0]?.email || "").trim();
  const to = String(payload.to || fallbackTo || "").trim();
  if (!to) {
    res.status(400).json({
      message: "Informe o e-mail de destino para teste.",
    });
    return;
  }

  try {
    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: login,
        pass: password,
      },
    });
    await transport.verify();
    await transport.sendMail({
      from: login,
      to,
      subject: "[MC Serviços] Teste de configuração de e-mail",
      text:
        "Este é um e-mail de teste enviado pelo MC Serviços.\n\n" +
        `Host SMTP: ${smtpHost}\n` +
        `Porta SMTP: ${smtpPort}\n` +
        `Data/Hora: ${new Date().toLocaleString("pt-BR")}\n`,
      html:
        `<p>Este é um e-mail de teste enviado pelo <strong>MC Serviços</strong>.</p>` +
        `<p><strong>Host SMTP:</strong> ${smtpHost}<br/>` +
        `<strong>Porta SMTP:</strong> ${smtpPort}<br/>` +
        `<strong>Data/Hora:</strong> ${new Date().toLocaleString("pt-BR")}</p>`,
    });
    res.json({
      ok: true,
      message: `E-mail de teste enviado para ${to}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao enviar e-mail de teste.";
    res.status(400).json({
      message: `Falha ao enviar teste: ${message}`,
    });
  }
});

export { webmailRouter };
