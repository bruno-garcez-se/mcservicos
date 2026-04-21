export type CertidaoTipo = "CNDT" | "CNF" | "CRF";

export type CertidaoStatus = "valida" | "vencendo" | "vencida" | "pendente" | "falha";

export type RunnerMode = "backend" | "agent";

export type CertidaoProviderPayload = {
  issueDate?: string | null;
  expiryDate?: string | null;
  controlCode?: string | null;
  pdfBase64?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
  ok?: boolean;
  errorMessage?: string | null;
};

export type CertidaoFetchResult = {
  ok: boolean;
  issueDate: string | null;
  expiryDate: string | null;
  controlCode: string | null;
  pdfBase64: string | null;
  sourceUrl: string | null;
  rawText: string | null;
  errorMessage: string | null;
};

export type CertificateConfigRecord = {
  cnpj: string;
  runnerMode: RunnerMode;
  certificateName: string | null;
  certificateContentBase64: string | null;
  certificatePassword: string | null;
  certificateExpiresAt: string | null;
  certificateUpdatedAt: string | null;
};

export type CertidaoRecord = {
  certType: CertidaoTipo;
  status: CertidaoStatus;
  issueDate: string | null;
  expiryDate: string | null;
  controlCode: string | null;
  sourceUrl: string | null;
  storagePath: string | null;
  fileHash: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};
