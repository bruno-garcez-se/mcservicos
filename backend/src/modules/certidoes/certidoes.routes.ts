import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/auth";
import {
  createNfseDraft,
  getNfseDraftAttachmentPath,
  getCertidaoDownloadPath,
  getCertidoesStatus,
  getDefaultCnpj,
  getMonthlyObligationCombinedPdf,
  getMonthlyObligationDownloadPath,
  importNfseDraftsFromXml,
  listNfseDrafts,
  markNfseDraftAsEmitted,
  listMonthlyObligations,
  deleteMonthlyObligation,
  refreshCertidoes,
  extractManualDataFromPdf,
  upsertMonthlyObligation,
  upsertManualCertidao,
  upsertCertificateConfig,
} from "./certidoes.service";

const certidoesRouter = Router();
const certTypeSchema = z.enum(["CNDT", "CNF", "CRF", "CNDM", "CNDE", "CNDJ"]);
const monthlyObligationTypeSchema = z.enum(["SIMPLES", "FGTS"]);
const monthlyUploadModeSchema = z.enum(["single", "separate"]);
const nfseTemplateKeySchema = z.enum(["DIA_5_RETIDO", "DIA_20_SEM_RETENCAO"]);
const nfseDraftStatusSchema = z.enum(["preparada", "emitida"]);

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

certidoesRouter.post("/manual/extract", async (req, res) => {
  const payload = z
    .object({
      certType: certTypeSchema,
      pdfBase64: z.string().min(100).max(20_000_000),
    })
    .parse(req.body ?? {});

  const extracted = await extractManualDataFromPdf({
    certType: payload.certType,
    pdfBase64: payload.pdfBase64,
  });
  res.json({
    issueDate: extracted.issueDate,
    expiryDate: extracted.expiryDate,
    controlCode: extracted.controlCode,
    foundAny: Boolean(extracted.issueDate || extracted.expiryDate || extracted.controlCode),
  });
});

certidoesRouter.post("/manual", async (req, res) => {
  const user = req.user!;
  const payload = z
    .object({
      cnpj: z.string().min(14),
      certType: certTypeSchema,
      issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      controlCode: z.string().max(180).optional(),
      sourceUrl: z.string().url().optional(),
      pdfBase64: z.string().max(20_000_000).optional(),
    })
    .parse(req.body ?? {});

  await upsertManualCertidao({
    cnpj: payload.cnpj,
    certType: payload.certType,
    issueDate: payload.issueDate,
    expiryDate: payload.expiryDate,
    controlCode: payload.controlCode,
    sourceUrl: payload.sourceUrl,
    pdfBase64: payload.pdfBase64,
    userId: user.id,
  });
  const data = await getCertidoesStatus(payload.cnpj);
  res.status(201).json(data);
});

certidoesRouter.get("/monthly", async (req, res) => {
  const query = z
    .object({
      cnpj: z.string().min(14).optional(),
    })
    .parse(req.query);
  const fallbackCnpj = await getDefaultCnpj();
  const cnpj = normalizeCnpj(query.cnpj ?? fallbackCnpj ?? "");
  if (!cnpj) {
    res.json({ items: [] });
    return;
  }
  const items = await listMonthlyObligations(cnpj);
  res.json({ items });
});

certidoesRouter.post("/monthly", async (req, res) => {
  const user = req.user!;
  const payload = z
    .object({
      cnpj: z.string().min(14),
      obligationType: monthlyObligationTypeSchema,
      competency: z.string().regex(/^\d{4}-\d{2}$/),
      uploadMode: monthlyUploadModeSchema,
      singleFile: z
        .object({
          fileName: z.string().min(1).max(200),
          base64: z.string().min(50).max(30_000_000),
        })
        .optional(),
      boletoFile: z
        .object({
          fileName: z.string().min(1).max(200),
          base64: z.string().min(50).max(30_000_000),
        })
        .optional(),
      receiptFile: z
        .object({
          fileName: z.string().min(1).max(200),
          base64: z.string().min(50).max(30_000_000),
        })
        .optional(),
    })
    .parse(req.body ?? {});

  if (payload.uploadMode === "single" && !payload.singleFile?.base64) {
    res.status(400).json({ message: "Arquivo único é obrigatório no modo de envio único." });
    return;
  }
  if (payload.uploadMode === "separate" && !payload.boletoFile?.base64 && !payload.receiptFile?.base64) {
    res.status(400).json({ message: "Informe ao menos boleto ou comprovante no modo de envio separado." });
    return;
  }

  await upsertMonthlyObligation({
    cnpj: payload.cnpj,
    obligationType: payload.obligationType,
    competency: payload.competency,
    uploadMode: payload.uploadMode,
    singleFile: payload.singleFile,
    boletoFile: payload.boletoFile,
    receiptFile: payload.receiptFile,
    userId: user.id,
  });
  const items = await listMonthlyObligations(payload.cnpj);
  res.status(201).json({ items });
});

certidoesRouter.get("/nfse-drafts", async (req, res) => {
  const query = z
    .object({
      cnpj: z.string().min(14).optional(),
      templateKey: nfseTemplateKeySchema.optional(),
      status: nfseDraftStatusSchema.optional(),
      competency: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      search: z.string().max(120).optional(),
    })
    .parse(req.query);
  const fallbackCnpj = await getDefaultCnpj();
  const cnpj = normalizeCnpj(query.cnpj ?? fallbackCnpj ?? "");
  if (!cnpj) {
    res.json({ items: [] });
    return;
  }
  const items = await listNfseDrafts({
    cnpj,
    templateKey: query.templateKey,
    status: query.status,
    competency: query.competency,
    search: query.search,
  });
  res.json({ items });
});

certidoesRouter.post("/nfse-drafts", async (req, res) => {
  const user = req.user!;
  const payload = z
    .object({
      cnpj: z.string().min(14),
      templateKey: nfseTemplateKeySchema,
      competency: z.string().regex(/^\d{4}-\d{2}$/),
      tomadorLabel: z.string().min(2).max(180),
      issMode: z.string().min(2).max(120),
      referenceDay: z.union([z.literal(5), z.literal(20)]),
      serviceDescription: z.string().min(3).max(2000),
      amount: z.number().positive(),
      status: nfseDraftStatusSchema.optional(),
    })
    .parse(req.body ?? {});
  await createNfseDraft({
    cnpj: payload.cnpj,
    templateKey: payload.templateKey,
    competency: payload.competency,
    tomadorLabel: payload.tomadorLabel,
    issMode: payload.issMode,
    referenceDay: payload.referenceDay,
    serviceDescription: payload.serviceDescription,
    amount: payload.amount,
    status: payload.status,
    userId: user.id,
  });
  const items = await listNfseDrafts({ cnpj: payload.cnpj });
  res.status(201).json({ items });
});

certidoesRouter.post("/nfse-drafts/import-xml", async (req, res) => {
  const user = req.user!;
  const payload = z
    .object({
      cnpj: z.string().min(14).optional(),
      files: z
        .array(
          z.object({
            fileName: z.string().min(1).max(220),
            base64: z.string().min(80).max(30_000_000),
          }),
        )
        .min(1)
        .max(100),
    })
    .parse(req.body ?? {});
  const result = await importNfseDraftsFromXml({
    cnpj: payload.cnpj,
    files: payload.files,
    userId: user.id,
  });
  const queryCnpj = normalizeCnpj(payload.cnpj ?? "");
  const items = queryCnpj
    ? await listNfseDrafts({ cnpj: queryCnpj })
    : await listNfseDrafts({ cnpj: normalizeCnpj((await getDefaultCnpj()) ?? "") });
  res.status(201).json({
    items,
    imported: result.imported,
    skipped: result.skipped,
  });
});

certidoesRouter.patch("/nfse-drafts/:id/emitted", async (req, res) => {
  const params = z
    .object({
      id: z.coerce.number().int().positive(),
    })
    .parse(req.params);
  const payload = z
    .object({
      cnpj: z.string().min(14),
      invoiceNumber: z.string().min(1).max(40),
      verificationCode: z.string().min(1).max(60),
      emittedAt: z.string().datetime().optional(),
      xmlFile: z
        .object({
          fileName: z.string().min(1).max(220),
          base64: z.string().min(50).max(30_000_000),
        })
        .optional(),
      pdfFile: z
        .object({
          fileName: z.string().min(1).max(220),
          base64: z.string().min(50).max(30_000_000),
        })
        .optional(),
    })
    .parse(req.body ?? {});
  await markNfseDraftAsEmitted({
    id: params.id,
    cnpj: payload.cnpj,
    invoiceNumber: payload.invoiceNumber,
    verificationCode: payload.verificationCode,
    emittedAt: payload.emittedAt,
    xmlFile: payload.xmlFile,
    pdfFile: payload.pdfFile,
  });
  const items = await listNfseDrafts({ cnpj: payload.cnpj });
  res.json({ items });
});

certidoesRouter.get("/nfse-drafts/:id/:kind/download", async (req, res) => {
  const params = z
    .object({
      id: z.coerce.number().int().positive(),
      kind: z.enum(["xml", "pdf"]),
    })
    .parse(req.params);
  const query = z.object({ cnpj: z.string().min(14) }).parse(req.query);
  const filePath = await getNfseDraftAttachmentPath({
    id: params.id,
    cnpj: query.cnpj,
    kind: params.kind,
  });
  if (!filePath) {
    res.status(404).json({ message: "Arquivo da NFS-e não encontrado." });
    return;
  }
  res.download(filePath);
});

certidoesRouter.get("/monthly/:obligationType/:competency/combined/download", async (req, res) => {
  const params = z
    .object({
      obligationType: monthlyObligationTypeSchema,
      competency: z.string().regex(/^\d{4}-\d{2}$/),
    })
    .parse(req.params);
  const query = z.object({ cnpj: z.string().min(14) }).parse(req.query);
  const merged = await getMonthlyObligationCombinedPdf({
    cnpj: query.cnpj,
    obligationType: params.obligationType,
    competency: params.competency,
  });
  if (!merged) {
    res.status(404).json({ message: "Não foi possível gerar o PDF combinado para esta competência." });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${merged.fileName}"`);
  res.send(merged.buffer);
});

certidoesRouter.get("/monthly/:obligationType/:competency/:kind/download", async (req, res) => {
  const params = z
    .object({
      obligationType: monthlyObligationTypeSchema,
      competency: z.string().regex(/^\d{4}-\d{2}$/),
      kind: z.enum(["single", "boleto", "receipt"]),
    })
    .parse(req.params);
  const query = z.object({ cnpj: z.string().min(14) }).parse(req.query);
  const filePath = await getMonthlyObligationDownloadPath({
    cnpj: query.cnpj,
    obligationType: params.obligationType,
    competency: params.competency,
    kind: params.kind,
  });
  if (!filePath) {
    res.status(404).json({ message: "Arquivo mensal não encontrado para download." });
    return;
  }
  res.download(filePath);
});

certidoesRouter.delete("/monthly/:obligationType/:competency", async (req, res) => {
  const params = z
    .object({
      obligationType: monthlyObligationTypeSchema,
      competency: z.string().regex(/^\d{4}-\d{2}$/),
    })
    .parse(req.params);
  const query = z.object({ cnpj: z.string().min(14) }).parse(req.query);
  await deleteMonthlyObligation({
    cnpj: query.cnpj,
    obligationType: params.obligationType,
    competency: params.competency,
  });
  const items = await listMonthlyObligations(query.cnpj);
  res.json({ items });
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
