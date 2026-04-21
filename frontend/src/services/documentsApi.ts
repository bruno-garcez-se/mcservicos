import { http } from "./http";
import { DocumentCertificateConfig, DocumentCertidao, DocumentCertidaoTipo } from "../types";

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
  const baseUrl = (import.meta.env.VITE_API_URL ?? "http://localhost:3333").replace(/\/+$/, "");
  const url = `${baseUrl}/documents/certidoes/${certType}/download?cnpj=${encodeURIComponent(cnpj)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
