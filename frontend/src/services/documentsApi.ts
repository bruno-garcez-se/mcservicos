import { http } from "./http";
import {
  DocumentCertificateConfig,
  DocumentCertidao,
  DocumentCertidaoTipo,
  DocumentNfseDraft,
  DocumentNfseDraftStatus,
  DocumentNfseTemplateKey,
  DocumentMonthlyObligation,
  DocumentMonthlyObligationType,
  DocumentMonthlyUploadMode,
} from "../types";

function extractFileNameFromDisposition(contentDisposition?: string): string | null {
  if (!contentDisposition) return null;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] ?? null;
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

async function downloadAuthenticatedFile(path: string, fallbackFileName: string, params?: Record<string, string>): Promise<void> {
  const response = await http.get(path, {
    params,
    responseType: "blob",
  });
  const contentDisposition = response.headers["content-disposition"] as string | undefined;
  const finalName = extractFileNameFromDisposition(contentDisposition) || fallbackFileName;
  triggerBlobDownload(response.data as Blob, finalName);
}

export async function getCertidoesStatus(cnpj?: string): Promise<{
  config: DocumentCertificateConfig | null;
  items: DocumentCertidao[];
}> {
  const normalized = (cnpj ?? "").trim();
  const { data } = await http.get("/documents/certidoes/status", {
    params: normalized ? { cnpj: normalized } : undefined,
  });
  return data;
}

export async function saveCertificateConfig(payload: {
  cnpj: string;
  certificateName?: string;
  certificateContentBase64?: string;
  certificatePassword?: string;
}): Promise<{ config: DocumentCertificateConfig | null; items: DocumentCertidao[] }> {
  const { data } = await http.post("/documents/certidoes/certificate", payload);
  return data;
}

export async function refreshCertidoes(payload: {
  cnpj: string;
  certTypes?: DocumentCertidaoTipo[];
}): Promise<{ config: DocumentCertificateConfig | null; items: DocumentCertidao[] }> {
  const { data } = await http.post("/documents/certidoes/refresh", payload);
  return data;
}

export async function registerManualCertidao(payload: {
  cnpj: string;
  certType: DocumentCertidaoTipo;
  issueDate?: string;
  expiryDate: string;
  controlCode?: string;
  sourceUrl?: string;
  pdfBase64?: string;
}): Promise<{ config: DocumentCertificateConfig | null; items: DocumentCertidao[] }> {
  const { data } = await http.post("/documents/certidoes/manual", payload);
  return data;
}

export async function extractManualCertidaoData(payload: {
  certType: DocumentCertidaoTipo;
  pdfBase64: string;
}): Promise<{
  issueDate: string | null;
  expiryDate: string | null;
  controlCode: string | null;
  foundAny: boolean;
}> {
  const { data } = await http.post("/documents/certidoes/manual/extract", payload);
  return data;
}

export async function downloadCertidao(cnpj: string, certType: DocumentCertidaoTipo): Promise<void> {
  await downloadAuthenticatedFile(`/documents/certidoes/${certType}/download`, `${certType}-${cnpj}.pdf`, { cnpj });
}

export async function listMonthlyObligations(cnpj?: string): Promise<{ items: DocumentMonthlyObligation[] }> {
  const normalized = (cnpj ?? "").trim();
  const { data } = await http.get("/documents/certidoes/monthly", {
    params: normalized ? { cnpj: normalized } : undefined,
  });
  return data;
}

export async function upsertMonthlyObligation(payload: {
  cnpj: string;
  obligationType: DocumentMonthlyObligationType;
  competency: string;
  uploadMode: DocumentMonthlyUploadMode;
  singleFile?: { fileName: string; base64: string };
  boletoFile?: { fileName: string; base64: string };
  receiptFile?: { fileName: string; base64: string };
}): Promise<{ items: DocumentMonthlyObligation[] }> {
  const { data } = await http.post("/documents/certidoes/monthly", payload);
  return data;
}

export async function downloadMonthlyObligation(input: {
  cnpj: string;
  obligationType: DocumentMonthlyObligationType;
  competency: string;
  kind: "single" | "boleto" | "receipt";
}): Promise<void> {
  await downloadAuthenticatedFile(
    `/documents/certidoes/monthly/${input.obligationType}/${input.competency}/${input.kind}/download`,
    `${input.obligationType}-${input.competency}-${input.kind}.pdf`,
    { cnpj: input.cnpj },
  );
}

export async function downloadMonthlyCombinedObligation(input: {
  cnpj: string;
  obligationType: DocumentMonthlyObligationType;
  competency: string;
}): Promise<void> {
  await downloadAuthenticatedFile(
    `/documents/certidoes/monthly/${input.obligationType}/${input.competency}/combined/download`,
    `${input.obligationType}-${input.competency}-combinado.pdf`,
    { cnpj: input.cnpj },
  );
}

export async function deleteMonthlyObligation(input: {
  cnpj: string;
  obligationType: DocumentMonthlyObligationType;
  competency: string;
}): Promise<{ items: DocumentMonthlyObligation[] }> {
  const { data } = await http.delete(
    `/documents/certidoes/monthly/${input.obligationType}/${input.competency}`,
    { params: { cnpj: input.cnpj } },
  );
  return data;
}

export async function listNfseDrafts(cnpj?: string): Promise<{ items: DocumentNfseDraft[] }> {
  const normalized = (cnpj ?? "").trim();
  const { data } = await http.get("/documents/certidoes/nfse-drafts", {
    params: normalized ? { cnpj: normalized } : undefined,
  });
  return data;
}

export async function createNfseDraft(payload: {
  cnpj: string;
  templateKey: DocumentNfseTemplateKey;
  competency: string;
  tomadorLabel: string;
  issMode: string;
  referenceDay: number;
  serviceDescription: string;
  amount: number;
  status?: DocumentNfseDraftStatus;
}): Promise<{ items: DocumentNfseDraft[] }> {
  const { data } = await http.post("/documents/certidoes/nfse-drafts", payload);
  return data;
}

export async function markNfseDraftAsEmitted(payload: {
  id: number;
  cnpj: string;
  invoiceNumber: string;
  verificationCode: string;
  emittedAt?: string;
  xmlFile?: { fileName: string; base64: string };
  pdfFile?: { fileName: string; base64: string };
}): Promise<{ items: DocumentNfseDraft[] }> {
  const { data } = await http.patch(`/documents/certidoes/nfse-drafts/${payload.id}/emitted`, {
    cnpj: payload.cnpj,
    invoiceNumber: payload.invoiceNumber,
    verificationCode: payload.verificationCode,
    emittedAt: payload.emittedAt,
    xmlFile: payload.xmlFile,
    pdfFile: payload.pdfFile,
  });
  return data;
}

export async function downloadNfseDraftAttachment(input: {
  id: number;
  cnpj: string;
  kind: "xml" | "pdf";
}): Promise<void> {
  await downloadAuthenticatedFile(
    `/documents/certidoes/nfse-drafts/${input.id}/${input.kind}/download`,
    `nfse-${input.id}.${input.kind}`,
    { cnpj: input.cnpj },
  );
}

export async function importNfseDraftsFromXml(payload: {
  cnpj?: string;
  files: Array<{ fileName: string; base64: string }>;
}): Promise<{ items: DocumentNfseDraft[]; imported: number; skipped: number }> {
  const { data } = await http.post("/documents/certidoes/nfse-drafts/import-xml", payload);
  return data;
}
