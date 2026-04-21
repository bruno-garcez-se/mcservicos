export type CertidaoTipo = "CNDT" | "CNF" | "CRF";

export type CertidaoStatus = "valida" | "vencendo" | "vencida" | "pendente" | "falha";
export type MonthlyObligationType = "SIMPLES" | "FGTS";
export type MonthlyUploadMode = "single" | "separate";
export type NfseTemplateKey = "DIA_5_RETIDO" | "DIA_20_SEM_RETENCAO";
export type NfseDraftStatus = "preparada" | "emitida";

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

export type MonthlyObligationRecord = {
  cnpj: string;
  obligationType: MonthlyObligationType;
  competency: string;
  uploadMode: MonthlyUploadMode;
  singleFileName: string | null;
  singleStoragePath: string | null;
  boletoFileName: string | null;
  boletoStoragePath: string | null;
  receiptFileName: string | null;
  receiptStoragePath: string | null;
  updatedAt: string | null;
};

export type NfseDraftRecord = {
  id: number;
  cnpj: string;
  templateKey: NfseTemplateKey;
  competency: string;
  tomadorLabel: string;
  issMode: string;
  referenceDay: number;
  serviceDescription: string;
  amount: number;
  status: NfseDraftStatus;
  invoiceNumber: string | null;
  verificationCode: string | null;
  emittedAt: string | null;
  xmlFileName: string | null;
  xmlStoragePath: string | null;
  pdfFileName: string | null;
  pdfStoragePath: string | null;
  createdAt: string;
  updatedAt: string;
};
