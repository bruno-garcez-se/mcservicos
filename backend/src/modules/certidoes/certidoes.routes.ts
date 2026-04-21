import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/auth";
import {
  getCertidaoDownloadPath,
  getCertidoesStatus,
  getDefaultCnpj,
  refreshCertidoes,
  upsertCertificateConfig,
} from "./certidoes.service";

const certidoesRouter = Router();
const certTypeSchema = z.enum(["CNDT", "CNF", "CRF"]);

function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, "");
}

certidoesRouter.use(requireAuth);

certidoesRouter.get("/status", async (req, res) => {
  const query = z
    .object({
      cnpj: z.string().min(14).optional(),
    })
    .parse(req.query);
  const fallbackCnpj = await getDefaultCnpj();
  const cnpj = normalizeCnpj(query.cnpj ?? fallbackCnpj ?? "");
  if (!cnpj) {
    res.json({ config: null, items: [] });
    return;
  }
  const data = await getCertidoesStatus(cnpj);
  res.json(data);
});

certidoesRouter.post("/certificate", async (req, res) => {
  const user = req.user!;
  const payload = z
    .object({
      cnpj: z.string().min(14),
      certificateName: z.string().max(180).optional(),
      certificateContentBase64: z.string().max(20_000_000).optional(),
      certificatePassword: z.string().max(500).optional(),
    })
    .parse(req.body ?? {});
  await upsertCertificateConfig({
    cnpj: payload.cnpj,
    certificateName: payload.certificateName,
    certificateContentBase64: payload.certificateContentBase64,
    certificatePassword: payload.certificatePassword,
    userId: user.id,
  });
  const data = await getCertidoesStatus(payload.cnpj);
  res.status(201).json(data);
});

certidoesRouter.post("/refresh", async (req, res) => {
  const user = req.user!;
  const payload = z
    .object({
      cnpj: z.string().min(14),
      certTypes: z.array(certTypeSchema).optional(),
    })
    .parse(req.body ?? {});
  await refreshCertidoes({
    cnpj: payload.cnpj,
    certTypes: payload.certTypes,
    userId: user.id,
  });
  const data = await getCertidoesStatus(payload.cnpj);
  res.json(data);
});

certidoesRouter.get("/:tipo/download", async (req, res) => {
  const params = z.object({ tipo: certTypeSchema }).parse(req.params);
  const query = z.object({ cnpj: z.string().min(14) }).parse(req.query);
  const filePath = await getCertidaoDownloadPath(query.cnpj, params.tipo);
  if (!filePath) {
    res.status(404).json({ message: "Certidão não encontrada para download." });
    return;
  }
  res.download(filePath);
});

export { certidoesRouter };
