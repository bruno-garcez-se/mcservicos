import { ChangeEvent, Fragment, useEffect, useMemo, useState } from "react";
import {
  DocumentNfseDraft,
  DocumentNfseTemplateKey,
  DocumentCertidao,
  DocumentCertidaoStatus,
  DocumentCertidaoTipo,
  DocumentMonthlyObligation,
  DocumentMonthlyObligationType,
  DocumentMonthlyUploadMode,
} from "../types";
import {
  createNfseDraft,
  deleteMonthlyObligation,
  downloadNfseDraftAttachment,
  downloadCertidao,
  downloadMonthlyCombinedObligation,
  downloadMonthlyObligation,
  extractManualCertidaoData,
  getCertidoesStatus,
  listMonthlyObligations,
  listNfseDrafts,
  markNfseDraftAsEmitted,
  importNfseDraftsFromXml,
  refreshCertidoes,
  registerManualCertidao,
  saveCertificateConfig,
  upsertMonthlyObligation,
} from "../services/documentsApi";

const CERT_LABELS: Record<DocumentCertidaoTipo, string> = {
  CNDT: "CNDT - TST - CERTIDÃO NEGATIVA DE DÉBITOS TRABALHISTAS",
  CNF: "CNF - CERTIDÃO NEGATIVA DÉBITOS TRIBUTOS FEDERAIS E DIVIDA ATIVA UNIÃO",
  CRF: "CRF - FGTS - CERTIFICADO DE REGULARIDADE DO FGTS",
  CNDM: "CNDM - MUNICIPAL - CERTIDÃO NEGATIVA DE DÉBITOS TRIBUTÁRIOS MUNICIPAIS",
  CNDE: "CNDE - ESTADUAL - CERTIDÃO NEGATIVA DE DÉBITOS ESTADUAIS",
  CNDJ: "CNDJ - JUDICIAL CÍVEL - CERTIDÃO JUDICIAL (NADA CONSTA)",
};

const CERT_PORTAL_URL: Record<DocumentCertidaoTipo, string> = {
  CNDT: "https://cndt-certidao.tst.jus.br/inicio.faces",
  CNF: "https://solucoes.receita.fazenda.gov.br/Servicos/certidao/",
  CRF: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf",
  CNDM: "https://gestor.tributosmunicipais.com.br/redesim/prefeitura/socorro/views/publico/portaldocontribuinte/publico/autenticacao/autenticacao.xhtml",
  CNDE: "https://www.sefaz.se.gov.br/SitePages/servico.aspx?cod=12",
  CNDJ: "https://www.tjse.jus.br/portal/servicos/judicial/certidao-online",
};
const PRIMARY_CERT_TYPES: DocumentCertidaoTipo[] = ["CNDT", "CNF", "CRF"];
const AUTO_REFRESH_CERT_TYPES = new Set<DocumentCertidaoTipo>(["CNDT", "CNF", "CRF"]);

const MONTHLY_OBLIGATION_LABELS: Record<DocumentMonthlyObligationType, string> = {
  SIMPLES: "Simples Nacional",
  FGTS: "FGTS",
};

const NFSE_TEMPLATE_OPTIONS: Record<
  DocumentNfseTemplateKey,
  {
    label: string;
    tomador: string;
    tomadorTaxId: string;
    issMode: string;
    referenceDay: number;
    descriptionPlaceholder: string;
  }
> = {
  DIA_5_RETIDO: {
    label: "Modelo dia 5",
    tomador: "BANCO DO ESTADO DE SERGIPE S/A (CNPJ: 13.009.717/0056-10)",
    tomadorTaxId: "13009717005610",
    issMode: "ISS retido pelo tomador",
    referenceDay: 5,
    descriptionPlaceholder:
      "DESCRIÇÃO DOS SERVIÇOS\n\nPIX SAQUE...\nCREDITO CONSIGNADO...\nRECARGA...\nPAGAMENTO...\nRECEBIMENTO...\nProdução por Ponto...",
  },
  DIA_20_SEM_RETENCAO: {
    label: "Modelo dia 20",
    tomador: "LY PROMOTORA EIRELI - EPP (CNPJ: 17.046.668/0001-72)",
    tomadorTaxId: "17046668000172",
    issMode: "Sem retenção de ISS",
    referenceDay: 20,
    descriptionPlaceholder:
      "Prestação de serviço de vendas\nCompetência: MM/AAAA\n\n- Banese Card / Serviços: R$ ...\n- Transacional: R$ ...\n- Consignado / Seguros: R$ ...\n- Lotese: R$ ...\n- TV Indoor: R$ ...",
  },
};

function monthIsoNow(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function suggestedCompetency(): string {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function suggestedNfseCompetency(templateKey: DocumentNfseTemplateKey): string {
  const now = new Date();
  const base = templateKey === "DIA_5_RETIDO" ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthInputToLabel(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  return formatMonthRef(value);
}

function extractPrestadorCnpjFromXml(xmlRaw: string): string {
  const blockMatch = xmlRaw.match(/<(?:\w+:)?Prestador[\s\S]*?<\/(?:\w+:)?Prestador>/i);
  if (!blockMatch?.[0]) return "";
  const cnpjMatch = blockMatch[0].match(/<(?:\w+:)?Cnpj>(\d{14})<\/(?:\w+:)?Cnpj>/i);
  return cnpjMatch?.[1] ?? "";
}

function formatMonthRef(monthRef: string): string {
  const [yearRaw, monthRaw] = monthRef.split("-").map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return monthRef;
  const date = new Date(yearRaw, monthRaw - 1, 1);
  const label = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatMonthlyDueDate(monthRef: string): string {
  const [yearRaw, monthRaw] = monthRef.split("-").map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return "-";
  const dueDate = new Date(yearRaw, monthRaw, 20);
  return dueDate.toLocaleDateString("pt-BR");
}

function RegisterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 3h8.8l4.2 4.2V20a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8.3 1.9V8h3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 10.3v7.4M8.3 14h7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RefreshIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className}>
      <path
        d="M20 6v5h-5M4 18v-5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 11a7 7 0 0 0-12-3M5 13a7 7 0 0 0 12 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 4v10M8 10l4 4 4-4M5 19h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m4 15.8 9.8-9.8 2.9 2.9-9.8 9.8H4zM14.9 4.9l2-2a1.3 1.3 0 0 1 1.8 0l2.4 2.4a1.3 1.3 0 0 1 0 1.8l-2 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M8 7l.8 11a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9L16 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.2 10.2v5.6M13.8 10.2v5.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SectionDocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 1.5V8h3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 12h6M9 15h6M9 18h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SectionCertidoesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3 4 7v5c0 4.2 3 7.9 8 9 5-1.1 8-4.8 8-9V7l-8-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m8.8 12 2.1 2.1 4.3-4.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SectionMonthlyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 4v3M17 4v3M5 9h14M6 6h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 14h2M13 14h2M9 17h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SectionNfseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 8h6M9 12h6M9 16h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16.7 16.7h3M18.2 15.2v3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, "");
}

function resolveDownloadCnpj(primary: string, fallback?: string | null): string {
  const preferred = normalizeCnpj(primary);
  if (preferred.length === 14) return preferred;
  return normalizeCnpj(String(fallback ?? ""));
}

function formatCnpj(value: string): string {
  const digits = normalizeCnpj(value).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

function computeStatusLabel(status: DocumentCertidaoStatus): string {
  if (status === "valida") return "Válida";
  if (status === "vencendo") return "Vencendo";
  if (status === "vencida") return "Vencida";
  if (status === "falha") return "Falha";
  return "Pendente";
}

function computeStatusClassName(status: DocumentCertidaoStatus): string {
  if (status === "vencida") return "documentos-status-vencida";
  return "";
}

function computeMonthlyFilesStatus(item: DocumentMonthlyObligation): "empty" | "partial" | "complete" {
  if (item.uploadMode === "single") {
    return item.singleStoragePath ? "complete" : "empty";
  }
  const count = Number(Boolean(item.boletoStoragePath)) + Number(Boolean(item.receiptStoragePath));
  if (count === 0) return "empty";
  if (count === 1) return "partial";
  return "complete";
}

function computeCertificateExpiryInfo(dateValue: string | null): string {
  if (!dateValue) return "Validade do certificado não informada.";
  const today = new Date();
  const base = new Date(`${dateValue}T00:00:00`);
  const diffDays = Math.floor((base.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `Certificado vencido em ${base.toLocaleDateString("pt-BR")}.`;
  if (diffDays <= 15) return `Certificado vence em ${diffDays} dia(s) (${base.toLocaleDateString("pt-BR")}).`;
  return `Certificado válido até ${base.toLocaleDateString("pt-BR")} (${diffDays} dias restantes).`;
}

function computeCertificateExpiryTone(dateValue: string | null): "ok" | "warning" | "danger" | "neutral" {
  if (!dateValue) return "neutral";
  const today = new Date();
  const base = new Date(`${dateValue}T00:00:00`);
  const diffDays = Math.floor((base.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "danger";
  if (diffDays <= 15) return "warning";
  return "ok";
}

function normalizeCertErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("executable doesn't exist") ||
    lower.includes("playwright install") ||
    lower.includes("browserType.launch".toLowerCase())
  ) {
    return "Automação CRF indisponível no servidor (navegador Playwright não instalado).";
  }
  try {
    const parsed = JSON.parse(trimmed) as { errorMessage?: unknown; message?: unknown };
    if (typeof parsed.errorMessage === "string" && parsed.errorMessage.trim()) return parsed.errorMessage.trim();
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // segue como texto puro
  }
  return trimmed;
}

function isCrfPortalBlockedError(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  return (
    normalized.includes("portal crf indisponível no momento (http 403)") ||
    normalized.includes("portal crf bloqueou a automação") ||
    normalized.includes("portal crf bloqueou a automacao") ||
    normalized.includes("shieldsquare") ||
    normalized.includes("captcha")
  );
}

export function DocumentosPage() {
  const [monthlyItems, setMonthlyItems] = useState<DocumentMonthlyObligation[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyModalOpen, setMonthlyModalOpen] = useState(false);
  const [monthlySaving, setMonthlySaving] = useState(false);
  const [monthlyType, setMonthlyType] = useState<DocumentMonthlyObligationType>("SIMPLES");
  const [monthlyCompetency, setMonthlyCompetency] = useState(suggestedCompetency());
  const [monthlyUploadMode, setMonthlyUploadMode] = useState<DocumentMonthlyUploadMode>("single");
  const [monthlySingleFileName, setMonthlySingleFileName] = useState("");
  const [monthlySingleBase64, setMonthlySingleBase64] = useState("");
  const [monthlyBoletoFileName, setMonthlyBoletoFileName] = useState("");
  const [monthlyBoletoBase64, setMonthlyBoletoBase64] = useState("");
  const [monthlyReceiptFileName, setMonthlyReceiptFileName] = useState("");
  const [monthlyReceiptBase64, setMonthlyReceiptBase64] = useState("");
  const [monthlyEditingItem, setMonthlyEditingItem] = useState<DocumentMonthlyObligation | null>(null);
  const [monthlyShowSingleUploadInput, setMonthlyShowSingleUploadInput] = useState(true);
  const [monthlyShowBoletoUploadInput, setMonthlyShowBoletoUploadInput] = useState(true);
  const [monthlyShowReceiptUploadInput, setMonthlyShowReceiptUploadInput] = useState(true);
  const [activeTab, setActiveTab] = useState<"certidoes" | "obrigacoes" | "nfse">("certidoes");
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [cnpj, setCnpj] = useState("");
  const [certificateName, setCertificateName] = useState("");
  const [certificatePassword, setCertificatePassword] = useState("");
  const [certificateExpiresAt, setCertificateExpiresAt] = useState("");
  const [certificateBase64, setCertificateBase64] = useState<string>("");
  const [certidoes, setCertidoes] = useState<DocumentCertidao[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingLabel, setRefreshingLabel] = useState("");
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualCertType, setManualCertType] = useState<DocumentCertidaoTipo>("CRF");
  const [manualIssueDate, setManualIssueDate] = useState("");
  const [manualExpiryDate, setManualExpiryDate] = useState("");
  const [manualControlCode, setManualControlCode] = useState("");
  const [manualSourceUrl, setManualSourceUrl] = useState("");
  const [manualPdfName, setManualPdfName] = useState("");
  const [manualPdfBase64, setManualPdfBase64] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualExtractingPdf, setManualExtractingPdf] = useState(false);
  const [manualExtractInfo, setManualExtractInfo] = useState("");
  const [manualExtractTone, setManualExtractTone] = useState<"neutral" | "success" | "warning" | "error">("neutral");
  const [nfseTemplate, setNfseTemplate] = useState<DocumentNfseTemplateKey>("DIA_5_RETIDO");
  const [nfseCompetency, setNfseCompetency] = useState<string>(() => suggestedNfseCompetency("DIA_5_RETIDO"));
  const [nfseDescription, setNfseDescription] = useState("");
  const [nfseAmount, setNfseAmount] = useState("");
  const [nfseItems, setNfseItems] = useState<DocumentNfseDraft[]>([]);
  const [nfseLoading, setNfseLoading] = useState(false);
  const [nfseSaving, setNfseSaving] = useState(false);
  const [nfseImporting, setNfseImporting] = useState(false);
  const [nfseFilterTemplate, setNfseFilterTemplate] = useState<"ALL" | DocumentNfseTemplateKey>("ALL");
  const [nfseFilterStatus, setNfseFilterStatus] = useState<"ALL" | "preparada" | "emitida">("ALL");
  const [nfseFilterSearch, setNfseFilterSearch] = useState("");
  const [nfseSummaryMonth, setNfseSummaryMonth] = useState(monthIsoNow());
  const [nfseEditModalOpen, setNfseEditModalOpen] = useState(false);
  const [nfseEditTarget, setNfseEditTarget] = useState<DocumentNfseDraft | null>(null);
  const [nfseInvoiceNumber, setNfseInvoiceNumber] = useState("");
  const [nfseVerificationCode, setNfseVerificationCode] = useState("");
  const [nfseEmittedAt, setNfseEmittedAt] = useState("");
  const [nfseXmlFileName, setNfseXmlFileName] = useState("");
  const [nfseXmlBase64, setNfseXmlBase64] = useState("");
  const [nfsePdfFileName, setNfsePdfFileName] = useState("");
  const [nfsePdfBase64, setNfsePdfBase64] = useState("");
  const [nfseMarkingEmitted, setNfseMarkingEmitted] = useState(false);
  const [message, setMessage] = useState("");

  const onRemoveMonthlyExistingFile = (kind: "single" | "boleto" | "receipt") => {
    const confirmed = window.confirm("Excluir este arquivo da obrigação mensal? Você poderá anexar outro em seguida.");
    if (!confirmed) return;
    setMonthlyEditingItem((prev) => {
      if (!prev) return prev;
      if (kind === "single") {
        return { ...prev, singleStoragePath: null, singleFileName: null };
      }
      if (kind === "boleto") {
        return { ...prev, boletoStoragePath: null, boletoFileName: null };
      }
      return { ...prev, receiptStoragePath: null, receiptFileName: null };
    });
    if (kind === "single") {
      setMonthlySingleBase64("");
      setMonthlySingleFileName("");
      setMonthlyShowSingleUploadInput(true);
      return;
    }
    if (kind === "boleto") {
      setMonthlyBoletoBase64("");
      setMonthlyBoletoFileName("");
      setMonthlyShowBoletoUploadInput(true);
      return;
    }
    setMonthlyReceiptBase64("");
    setMonthlyReceiptFileName("");
    setMonthlyShowReceiptUploadInput(true);
  };

  const certificateExpiryInfo = useMemo(() => computeCertificateExpiryInfo(certificateExpiresAt || null), [certificateExpiresAt]);
  const certificateExpiryTone = useMemo(() => computeCertificateExpiryTone(certificateExpiresAt || null), [certificateExpiresAt]);
  const primaryCertidoes = useMemo(
    () => PRIMARY_CERT_TYPES.map((certType) => certidoes.find((item) => item.certType === certType)).filter((item): item is DocumentCertidao => Boolean(item)),
    [certidoes],
  );
  const otherCertidoes = useMemo(
    () => certidoes.filter((item) => !PRIMARY_CERT_TYPES.includes(item.certType)),
    [certidoes],
  );
  const latestMonthlyByType = useMemo(() => {
    const map: Record<DocumentMonthlyObligationType, DocumentMonthlyObligation | null> = {
      SIMPLES: null,
      FGTS: null,
    };
    for (const item of monthlyItems) {
      if (!map[item.obligationType] || item.competency > (map[item.obligationType]?.competency ?? "")) {
        map[item.obligationType] = item;
      }
    }
    return map;
  }, [monthlyItems]);
  const selectedNfseTemplate = NFSE_TEMPLATE_OPTIONS[nfseTemplate];
  const filteredNfseItems = useMemo(() => {
    const term = nfseFilterSearch.trim().toLowerCase();
    return nfseItems.filter((item) => {
      if (nfseFilterTemplate !== "ALL" && item.templateKey !== nfseFilterTemplate) return false;
      if (nfseFilterStatus !== "ALL" && item.status !== nfseFilterStatus) return false;
      if (!term) return true;
      return (
        item.tomadorLabel.toLowerCase().includes(term) ||
        item.serviceDescription.toLowerCase().includes(term) ||
        (item.invoiceNumber ?? "").toLowerCase().includes(term) ||
        formatMonthInputToLabel(item.competency).toLowerCase().includes(term)
      );
    });
  }, [nfseItems, nfseFilterTemplate, nfseFilterStatus, nfseFilterSearch]);
  const nfseSummary = useMemo(() => {
    const monthItems = nfseItems.filter((item) => {
      const refDate = item.emittedAt ?? item.createdAt;
      return refDate.startsWith(nfseSummaryMonth);
    });
    const emittedItems = monthItems.filter((item) => item.status === "emitida");
    const expected = 2;
    const preparedTotal = monthItems.reduce((acc, item) => acc + item.amount, 0);
    const emittedTotal = emittedItems.reduce((acc, item) => acc + item.amount, 0);
    return {
      expected,
      prepared: monthItems.length,
      emitted: emittedItems.length,
      pending: Math.max(expected - emittedItems.length, 0),
      preparedTotal,
      emittedTotal,
    };
  }, [nfseItems, nfseSummaryMonth]);
  const nfseReminder = useMemo(() => {
    const now = new Date();
    const day = now.getDate();
    const previousMonth = suggestedNfseCompetency("DIA_5_RETIDO");
    const currentMonth = suggestedNfseCompetency("DIA_20_SEM_RETENCAO");
    if (day === 4) {
      const hasDay5 = nfseItems.some(
        (item) => item.templateKey === "DIA_5_RETIDO" && item.competency === previousMonth && item.status === "emitida",
      );
      if (!hasDay5) return `Lembrete: amanhã é dia 5. Falta emitir a NFS-e do modelo dia 5 (${formatMonthInputToLabel(previousMonth)}).`;
    }
    if (day === 19) {
      const hasDay20 = nfseItems.some(
        (item) => item.templateKey === "DIA_20_SEM_RETENCAO" && item.competency === currentMonth && item.status === "emitida",
      );
      if (!hasDay20) return `Lembrete: amanhã é dia 20. Falta emitir a NFS-e do modelo dia 20 (${formatMonthInputToLabel(currentMonth)}).`;
    }
    return "";
  }, [nfseItems]);

  const loadMonthly = async (targetCnpj?: string) => {
    setMonthlyLoading(true);
    try {
      const data = await listMonthlyObligations(targetCnpj);
      setMonthlyItems(data.items);
    } catch {
      setMonthlyItems([]);
    } finally {
      setMonthlyLoading(false);
    }
  };

  const loadNfseDrafts = async (targetCnpj?: string) => {
    setNfseLoading(true);
    try {
      const data = await listNfseDrafts(targetCnpj);
      setNfseItems(data.items);
    } catch {
      setNfseItems([]);
    } finally {
      setNfseLoading(false);
    }
  };

  const loadStatus = async (targetCnpj?: string) => {
    const normalized = normalizeCnpj(targetCnpj ?? "");
    if (targetCnpj && normalized.length !== 14) return;
    setLoading(true);
    try {
      const data = await getCertidoesStatus(normalized || undefined);
      setCertidoes(data.items);
      if (data.config) {
        setCnpj(formatCnpj(data.config.cnpj));
        setCertificateName(data.config.certificateName ?? "");
        setCertificateExpiresAt(data.config.certificateExpiresAt ?? "");
      }
      const monthlyCnpj = data.config?.cnpj ?? normalized;
      await loadMonthly(monthlyCnpj || undefined);
      await loadNfseDrafts(monthlyCnpj || undefined);
      setMessage("");
    } catch {
      setMessage("Falha ao carregar certidões.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    setNfseCompetency(suggestedNfseCompetency(nfseTemplate));
  }, [nfseTemplate]);

  const onCertificateFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCertificateName(file.name);
    const toBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : "";
        resolve(base64);
      };
      reader.onerror = () => reject(new Error("Falha ao ler certificado."));
      reader.readAsDataURL(file);
    });
    setCertificateBase64(toBase64);
  };

  const onManualPdfChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setManualPdfName(file.name);
    const toBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : "";
        resolve(base64);
      };
      reader.onerror = () => reject(new Error("Falha ao ler PDF."));
      reader.readAsDataURL(file);
    });
    setManualPdfBase64(toBase64);
    setManualExtractingPdf(true);
    setManualExtractInfo("Tentando identificar emissão, validade e código no PDF...");
    setManualExtractTone("neutral");
    try {
      const extracted = await extractManualCertidaoData({
        certType: manualCertType,
        pdfBase64: toBase64,
      });
      let extractedCount = 0;
      if (extracted.issueDate) {
        setManualIssueDate(extracted.issueDate);
        extractedCount += 1;
      }
      if (extracted.expiryDate) {
        setManualExpiryDate(extracted.expiryDate);
        extractedCount += 1;
      }
      if (extracted.controlCode) {
        setManualControlCode(extracted.controlCode);
        extractedCount += 1;
      }
      if (extractedCount === 0) {
        setManualExtractInfo("Não foi possível identificar os dados automaticamente. Preencha manualmente.");
        setManualExtractTone("warning");
      } else if (extractedCount < 3) {
        setManualExtractInfo("Identificação parcial no PDF. Complete os campos restantes manualmente.");
        setManualExtractTone("warning");
      } else {
        setManualExtractInfo("Dados identificados automaticamente a partir do PDF.");
        setManualExtractTone("success");
      }
    } catch (error) {
      const responseStatus = (error as { response?: { status?: number } }).response?.status;
      if (responseStatus === 404) {
        setManualExtractInfo("Extração automática indisponível no backend atual. Reinicie/atualize a API e tente novamente.");
      } else if (responseStatus === 413) {
        setManualExtractInfo("O PDF é maior que o limite aceito pela API. Tente um arquivo menor.");
      } else if (responseStatus === 401) {
        setManualExtractInfo("Sessão expirada para extração automática. Faça login novamente e tente outra vez.");
      } else {
        setManualExtractInfo("Falha ao ler o PDF automaticamente. Preencha os campos manualmente.");
      }
      setManualExtractTone("error");
    } finally {
      setManualExtractingPdf(false);
    }
  };

  const onMonthlySingleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMonthlySingleFileName(file.name);
    try {
      const base64 = await readFileAsBase64(file);
      setMonthlySingleBase64(base64);
    } catch {
      setMessage("Falha ao ler arquivo único mensal.");
    }
  };

  const onMonthlyBoletoFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMonthlyBoletoFileName(file.name);
    try {
      const base64 = await readFileAsBase64(file);
      setMonthlyBoletoBase64(base64);
    } catch {
      setMessage("Falha ao ler boleto mensal.");
    }
  };

  const onMonthlyReceiptFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMonthlyReceiptFileName(file.name);
    try {
      const base64 = await readFileAsBase64(file);
      setMonthlyReceiptBase64(base64);
    } catch {
      setMessage("Falha ao ler comprovante mensal.");
    }
  };

  const openMonthlyModal = (type?: DocumentMonthlyObligationType, item?: DocumentMonthlyObligation | null) => {
    if (item) {
      setMonthlyEditingItem(item);
      setMonthlyType(item.obligationType);
      setMonthlyCompetency(item.competency);
      setMonthlyUploadMode(item.uploadMode);
      setMonthlyShowSingleUploadInput(!item.singleStoragePath);
      setMonthlyShowBoletoUploadInput(!item.boletoStoragePath);
      setMonthlyShowReceiptUploadInput(!item.receiptStoragePath);
    } else {
      setMonthlyEditingItem(null);
      setMonthlyType(type ?? "SIMPLES");
      setMonthlyCompetency(suggestedCompetency());
      setMonthlyUploadMode("single");
      setMonthlyShowSingleUploadInput(true);
      setMonthlyShowBoletoUploadInput(true);
      setMonthlyShowReceiptUploadInput(true);
    }
    setMonthlySingleFileName("");
    setMonthlySingleBase64("");
    setMonthlyBoletoFileName("");
    setMonthlyBoletoBase64("");
    setMonthlyReceiptFileName("");
    setMonthlyReceiptBase64("");
    setMonthlyModalOpen(true);
  };

  const openManualModal = (certType: DocumentCertidaoTipo) => {
    setManualCertType(certType);
    setManualIssueDate("");
    setManualExpiryDate("");
    setManualControlCode("");
    setManualSourceUrl("");
    setManualPdfName("");
    setManualPdfBase64("");
    setManualExtractingPdf(false);
    setManualExtractInfo("");
    setManualExtractTone("neutral");
    setManualModalOpen(true);
  };

  const onSaveMonthly = async () => {
    const normalized = normalizeCnpj(cnpj);
    if (normalized.length !== 14) {
      setMessage("Informe um CNPJ válido para registrar obrigações mensais.");
      return;
    }
    const competency = monthlyCompetency || monthIsoNow();
    if (!/^\d{4}-\d{2}$/.test(competency)) {
      setMessage("Informe uma competência válida no formato MM/AAAA.");
      return;
    }
    const editingSameRecord =
      monthlyEditingItem &&
      monthlyEditingItem.obligationType === monthlyType &&
      monthlyEditingItem.competency === competency
        ? monthlyEditingItem
        : null;
    const hasSingleFile = Boolean(monthlySingleBase64 || editingSameRecord?.singleStoragePath);
    const hasSeparatedFile = Boolean(
      monthlyBoletoBase64 || monthlyReceiptBase64 || editingSameRecord?.boletoStoragePath || editingSameRecord?.receiptStoragePath,
    );
    if (monthlyUploadMode === "single" && !hasSingleFile) {
      setMessage("Anexe o arquivo único para continuar.");
      return;
    }
    if (monthlyUploadMode === "separate" && !hasSeparatedFile) {
      setMessage("No modo separado, anexe ao menos boleto ou comprovante.");
      return;
    }

    setMonthlySaving(true);
    try {
      const data = await upsertMonthlyObligation({
        cnpj: normalized,
        obligationType: monthlyType,
        competency,
        uploadMode: monthlyUploadMode,
        singleFile: monthlySingleBase64
          ? {
              fileName: monthlySingleFileName || "arquivo-unico.pdf",
              base64: monthlySingleBase64,
            }
          : undefined,
        boletoFile: monthlyBoletoBase64
          ? {
              fileName: monthlyBoletoFileName || "boleto.pdf",
              base64: monthlyBoletoBase64,
            }
          : undefined,
        receiptFile: monthlyReceiptBase64
          ? {
              fileName: monthlyReceiptFileName || "comprovante.pdf",
              base64: monthlyReceiptBase64,
            }
          : undefined,
      });
      setMonthlyItems(data.items);
      setMonthlyModalOpen(false);
      setMonthlyEditingItem(null);
      setMessage(`${MONTHLY_OBLIGATION_LABELS[monthlyType]} de ${formatMonthRef(competency)} registrada com sucesso.`);
    } catch {
      setMessage("Falha ao salvar obrigação mensal.");
    } finally {
      setMonthlySaving(false);
    }
  };

  const onDeleteMonthly = async (item: DocumentMonthlyObligation) => {
    const normalized = normalizeCnpj(item.cnpj || cnpj);
    if (normalized.length !== 14) {
      setMessage("Informe um CNPJ válido para excluir obrigação mensal.");
      return;
    }
    const confirmed = window.confirm(
      `Excluir ${MONTHLY_OBLIGATION_LABELS[item.obligationType]} da competência ${formatMonthRef(item.competency)}?`,
    );
    if (!confirmed) return;
    try {
      const data = await deleteMonthlyObligation({
        cnpj: normalized,
        obligationType: item.obligationType,
        competency: item.competency,
      });
      setMonthlyItems(data.items);
      setMessage(`${MONTHLY_OBLIGATION_LABELS[item.obligationType]} de ${formatMonthRef(item.competency)} excluída.`);
    } catch {
      setMessage("Falha ao excluir obrigação mensal.");
    }
  };

  const onSaveManual = async () => {
    const normalized = normalizeCnpj(cnpj);
    if (normalized.length !== 14) {
      setMessage("Informe um CNPJ válido para registrar manualmente.");
      return;
    }
    if (manualExtractingPdf) {
      setMessage("Aguarde a leitura do PDF antes de salvar.");
      return;
    }
    if (!manualIssueDate) {
      setMessage("Informe a data de emissão da certidão manual.");
      return;
    }
    if (!manualExpiryDate) {
      setMessage("Informe a validade da certidão manual.");
      return;
    }
    const issueDate = new Date(`${manualIssueDate}T00:00:00`);
    const expiryDate = new Date(`${manualExpiryDate}T00:00:00`);
    if (Number.isNaN(issueDate.getTime()) || Number.isNaN(expiryDate.getTime())) {
      setMessage("Datas de emissão e validade inválidas.");
      return;
    }
    if (expiryDate < issueDate) {
      setMessage("A validade da certidão não pode ser anterior à emissão.");
      return;
    }
    const normalizedControlCode = manualControlCode.trim();
    if (!normalizedControlCode) {
      setMessage("Informe o código de controle da certidão.");
      return;
    }
    setManualSaving(true);
    try {
      const data = await registerManualCertidao({
        cnpj: normalized,
        certType: manualCertType,
        issueDate: manualIssueDate,
        expiryDate: manualExpiryDate,
        controlCode: normalizedControlCode,
        sourceUrl: manualSourceUrl || undefined,
        pdfBase64: manualPdfBase64 || undefined,
      });
      setCertidoes(data.items);
      setManualModalOpen(false);
      setMessage(`${CERT_LABELS[manualCertType]} registrada manualmente com sucesso.`);
    } catch {
      setMessage("Falha ao registrar certidão manual.");
    } finally {
      setManualSaving(false);
    }
  };

  const onContinueInPortal = (certType: DocumentCertidaoTipo) => {
    const url = CERT_PORTAL_URL[certType];
    window.open(url, "_blank", "noopener,noreferrer");
    if (certType === "CRF") {
      setMessage("Portal do CRF aberto. Após emitir, use Registrar para lançar a certidão manualmente.");
    } else {
      setMessage(`Portal de ${certType} aberto. Após emitir, use Registrar para lançar a certidão manualmente.`);
    }
  };

  const withDownloadFeedback = async (action: () => Promise<void>, errorMessage: string) => {
    try {
      await action();
    } catch {
      setMessage(errorMessage);
    }
  };

  const onSaveConfig = async () => {
    const normalized = normalizeCnpj(cnpj);
    if (normalized.length !== 14) {
      setMessage("Informe um CNPJ válido com 14 dígitos.");
      return;
    }
    setSavingConfig(true);
    try {
      const data = await saveCertificateConfig({
        cnpj: normalized,
        certificateName: certificateBase64 ? certificateName || undefined : undefined,
        certificateContentBase64: certificateBase64 || undefined,
        certificatePassword: certificateBase64 ? certificatePassword || undefined : undefined,
      });
      setCertidoes(data.items);
      if (data.config) {
        setCnpj(formatCnpj(data.config.cnpj));
        setCertificateName(data.config.certificateName ?? "");
        setCertificateExpiresAt(data.config.certificateExpiresAt ?? "");
      }
      setCertificatePassword("");
      setCertificateBase64("");
      setIsConfigModalOpen(false);
      setMessage("Configuração de certificado salva.");
    } catch {
      setMessage("Falha ao salvar configuração do certificado.");
    } finally {
      setSavingConfig(false);
    }
  };

  const onRefresh = async (certTypes?: DocumentCertidaoTipo[]) => {
    const normalized = normalizeCnpj(cnpj);
    if (normalized.length !== 14) {
      setMessage("Informe um CNPJ válido para atualizar as certidões.");
      return;
    }
    const targetTypes = certTypes && certTypes.length > 0 ? certTypes : undefined;
    const targetLabel = targetTypes?.length ? targetTypes.join(", ") : "CNDT, CNF e CRF";
    setRefreshing(true);
    setRefreshingLabel(targetLabel);
    setMessage(`Atualizando ${targetLabel}... aguarde.`);
    try {
      const data = await refreshCertidoes({ cnpj: normalized, certTypes: targetTypes });
      setCertidoes(data.items);
      setMessage(`Atualização concluída (${targetLabel}). Créditos consumidos conforme as certidões consultadas.`);
    } catch {
      setMessage("Falha ao atualizar certidões.");
    } finally {
      setRefreshing(false);
      setRefreshingLabel("");
    }
  };

  const onOpenNfseEmission = async () => {
    const normalized = normalizeCnpj(cnpj);
    if (normalized.length !== 14) {
      setMessage("Informe um CNPJ válido para registrar emissão NFS-e.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(nfseCompetency)) {
      setMessage("Informe uma competência válida para a NFS-e no formato MM/AAAA.");
      return;
    }
    const description = nfseDescription.trim();
    const amount = Number(nfseAmount.replace(/\./g, "").replace(",", "."));
    if (!description) {
      setMessage("Informe a descrição do serviço para emissão da NFS-e.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Informe um valor válido para emissão da NFS-e.");
      return;
    }
    const selectedTemplate = NFSE_TEMPLATE_OPTIONS[nfseTemplate];
    const amountLabel = amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const portalWindow = window.open("", "_blank");
    if (!portalWindow) {
      setMessage("O navegador bloqueou a abertura do WebISS. Permita pop-ups para este site e tente novamente.");
      return;
    }
    portalWindow.opener = null;
    portalWindow.location.href = "https://nossasenhoradosocorrose.webiss.com.br/";
    const sameTemplateEmissions = nfseItems
      .filter((item) => item.templateKey === nfseTemplate)
      .slice(0, 6)
      .map((item) => item.amount);
    if (sameTemplateEmissions.length >= 3) {
      const avg = sameTemplateEmissions.reduce((acc, value) => acc + value, 0) / sameTemplateEmissions.length;
      const deviation = Math.abs(amount - avg) / avg;
      if (deviation >= 0.4) {
        const confirmed = window.confirm(
          `Atenção: o valor ${amountLabel} está ${(deviation * 100).toFixed(0)}% diferente da média recente (${avg.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). Deseja continuar?`,
        );
        if (!confirmed) return;
      }
    }
    setNfseSaving(true);
    try {
      const data = await createNfseDraft({
        cnpj: normalized,
        templateKey: nfseTemplate,
        competency: nfseCompetency,
        tomadorLabel: selectedTemplate.tomador,
        issMode: selectedTemplate.issMode,
        referenceDay: selectedTemplate.referenceDay,
        serviceDescription: description,
        amount,
        status: "preparada",
      });
      setNfseItems(data.items);
      setMessage(
        `${selectedTemplate.label}: ${selectedTemplate.tomador}, ${selectedTemplate.issMode}. Valor ${amountLabel} salvo no histórico para ${formatMonthInputToLabel(nfseCompetency)}. Complete a emissão no portal WebISS.`,
      );
      setNfseDescription("");
      setNfseAmount("");
    } catch {
      if (!portalWindow.closed) {
        portalWindow.close();
      }
      setMessage("Falha ao salvar o histórico de emissão NFS-e.");
    } finally {
      setNfseSaving(false);
    }
  };

  const onImportNfseXmlFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setNfseImporting(true);
    try {
      const payloadFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          base64: await readFileAsBase64(file),
        })),
      );
      let normalized = normalizeCnpj(cnpj);
      if (normalized.length !== 14) {
        const firstXmlText = atob(payloadFiles[0]?.base64 ?? "");
        normalized = normalizeCnpj(extractPrestadorCnpjFromXml(firstXmlText));
      }
      const data = await importNfseDraftsFromXml({
        cnpj: normalized.length === 14 ? normalized : undefined,
        files: payloadFiles,
      });
      setNfseItems(data.items);
      setMessage(`Importação concluída: ${data.imported} XML(s) importado(s) e ${data.skipped} ignorado(s).`);
    } catch {
      setMessage("Falha ao importar XMLs de NFS-e.");
    } finally {
      setNfseImporting(false);
    }
  };

  const openNfseEmitModal = (item: DocumentNfseDraft) => {
    setNfseEditTarget(item);
    setNfseInvoiceNumber(item.invoiceNumber ?? "");
    setNfseVerificationCode(item.verificationCode ?? "");
    setNfseEmittedAt(item.emittedAt ? item.emittedAt.slice(0, 16) : new Date().toISOString().slice(0, 16));
    setNfseXmlFileName("");
    setNfseXmlBase64("");
    setNfsePdfFileName("");
    setNfsePdfBase64("");
    setNfseEditModalOpen(true);
  };

  const onNfseXmlChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setNfseXmlFileName(file.name);
    const base64 = await readFileAsBase64(file);
    setNfseXmlBase64(base64);
  };

  const onNfsePdfChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setNfsePdfFileName(file.name);
    const base64 = await readFileAsBase64(file);
    setNfsePdfBase64(base64);
  };

  const onSaveNfseEmitted = async () => {
    if (!nfseEditTarget) return;
    const normalized = normalizeCnpj(cnpj || nfseEditTarget.cnpj);
    if (normalized.length !== 14) {
      setMessage("Informe um CNPJ válido para concluir emissão da NFS-e.");
      return;
    }
    if (!nfseInvoiceNumber.trim()) {
      setMessage("Informe o número da NFS-e.");
      return;
    }
    if (!nfseVerificationCode.trim()) {
      setMessage("Informe o código de verificação.");
      return;
    }
    setNfseMarkingEmitted(true);
    try {
      const data = await markNfseDraftAsEmitted({
        id: nfseEditTarget.id,
        cnpj: normalized,
        invoiceNumber: nfseInvoiceNumber.trim(),
        verificationCode: nfseVerificationCode.trim(),
        emittedAt: nfseEmittedAt ? new Date(nfseEmittedAt).toISOString() : undefined,
        xmlFile: nfseXmlBase64 ? { fileName: nfseXmlFileName || "nfse.xml", base64: nfseXmlBase64 } : undefined,
        pdfFile: nfsePdfBase64 ? { fileName: nfsePdfFileName || "nfse.pdf", base64: nfsePdfBase64 } : undefined,
      });
      setNfseItems(data.items);
      setNfseEditModalOpen(false);
      setNfseEditTarget(null);
      setMessage("NFS-e marcada como emitida com sucesso.");
    } catch {
      setMessage("Falha ao concluir emissão da NFS-e.");
    } finally {
      setNfseMarkingEmitted(false);
    }
  };

  return (
    <div className="financeiro-page">
      <section className="card">
        <div className="section-header-row">
          <h2 className="documentos-title-with-icon">
            <SectionDocumentIcon />
            <span>Documentos</span>
          </h2>
        </div>
        <div className="loan-section-menu loan-section-menu-premium documentos-section-menu">
          <button type="button" className={activeTab === "certidoes" ? "active" : ""} onClick={() => setActiveTab("certidoes")}>
            <span className="loan-menu-icon-label">
              <SectionCertidoesIcon />
              Certidões
            </span>
          </button>
          <button type="button" className={activeTab === "obrigacoes" ? "active" : ""} onClick={() => setActiveTab("obrigacoes")}>
            <span className="loan-menu-icon-label">
              <SectionMonthlyIcon />
              Obrigações
            </span>
          </button>
          <button type="button" className={activeTab === "nfse" ? "active" : ""} onClick={() => setActiveTab("nfse")}>
            <span className="loan-menu-icon-label">
              <SectionNfseIcon />
              NFS-e
            </span>
          </button>
        </div>
      </section>

      <>
          <section className="card" hidden={activeTab !== "certidoes"}>
            <div className="section-header-row">
              <h3 className="documentos-title-with-icon">
                <SectionCertidoesIcon />
                <span>Certidões</span>
              </h3>
            </div>
            <div className="row documentos-certificado-row">
              <button
                type="button"
                className="primary-button documentos-certificado-button"
                onClick={() => setIsConfigModalOpen(true)}
                title="Adicionar certificado"
                aria-label="Adicionar certificado"
              >
                <RegisterIcon />
                <span>Certificado</span>
              </button>
              <span className={`cert-expiry-badge documentos-certificado-badge cert-expiry-badge-${certificateExpiryTone}`}>
                {certificateExpiresAt ? certificateExpiryInfo : "Sem certificado cadastrado."}
              </span>
            </div>
            {refreshing ? <p className="muted-text">{`Consultando ${refreshingLabel}...`}</p> : null}
            <table className="transaction-data-table">
              <thead>
                <tr>
                  <th>Certidão</th>
                  <th>Número</th>
                  <th>Emissão</th>
                  <th>Validade</th>
                  <th>Status</th>
                  <th>Última verificação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7}>Carregando certidões...</td>
                  </tr>
                ) : certidoes.length === 0 ? (
                  <tr>
                    <td colSpan={7}>Informe o CNPJ para carregar as certidões.</td>
                  </tr>
                ) : (
                  [...primaryCertidoes, ...otherCertidoes].map((item, index) => (
                    <Fragment key={`cert-fragment-${item.certType}-${index}`}>
                    {index === primaryCertidoes.length && otherCertidoes.length > 0 ? (
                      <tr key="cert-outros-header">
                        <td colSpan={7} className="documentos-certidoes-group-row">
                          Outras certidões
                        </td>
                      </tr>
                    ) : null}
                    <tr key={`cert-${item.certType}`}>
                      <td>{CERT_LABELS[item.certType]}</td>
                      <td>{item.controlCode ?? "-"}</td>
                      <td>{item.issueDate ? new Date(`${item.issueDate}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                      <td>{item.expiryDate ? new Date(`${item.expiryDate}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                      <td className={computeStatusClassName(item.status)}>{computeStatusLabel(item.status)}</td>
                      <td>{item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString("pt-BR") : "-"}</td>
                      <td>
                        <div className="row">
                          <button
                            type="button"
                            className="transaction-icon-button"
                            onClick={() => void onRefresh([item.certType])}
                            disabled={refreshing || !AUTO_REFRESH_CERT_TYPES.has(item.certType)}
                            aria-label={refreshing ? "Atualizando" : "Atualizar"}
                            title={
                              AUTO_REFRESH_CERT_TYPES.has(item.certType)
                                ? refreshing
                                  ? "Atualizando..."
                                  : "Atualizar"
                                : "Atualização automática indisponível para este tipo"
                            }
                          >
                            <RefreshIcon className={refreshing ? "documentos-refresh-icon-spinning" : undefined} />
                          </button>
                          <button
                            type="button"
                            className="transaction-icon-button"
                            onClick={() => openManualModal(item.certType)}
                            aria-label="Registrar manualmente"
                            title="Registrar manualmente"
                          >
                            <RegisterIcon />
                          </button>
                          <button
                            type="button"
                            className="transaction-icon-button"
                            onClick={() =>
                              void withDownloadFeedback(
                                () => downloadCertidao(resolveDownloadCnpj(cnpj), item.certType),
                                "Falha ao baixar certidão.",
                              )
                            }
                            disabled={!item.storagePath}
                            aria-label="Baixar"
                            title="Baixar"
                          >
                            <DownloadIcon />
                          </button>
                        </div>
                        {item.lastError ? <small className="error-text">{normalizeCertErrorMessage(item.lastError)}</small> : null}
                        {!AUTO_REFRESH_CERT_TYPES.has(item.certType) ? (
                          <small className="muted-text">Atualização manual: use Registrar para anexar a certidão.</small>
                        ) : null}
                        {item.certType === "CRF" && isCrfPortalBlockedError(item.lastError) ? (
                          <button
                            type="button"
                            className="documentos-portal-button"
                            onClick={() => onContinueInPortal(item.certType)}
                          >
                            Continuar no portal
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </section>
          <section className="card documentos-obrigacoes-section" hidden={activeTab !== "obrigacoes"}>
            <div className="section-header-row">
              <h3 className="documentos-title-with-icon">
                <SectionMonthlyIcon />
                <span>Obrigações mensais</span>
              </h3>
              <button type="button" className="primary-button documentos-monthly-new-button" onClick={() => openMonthlyModal()}>
                <PlusIcon />
                <span>Novo</span>
              </button>
            </div>
            <div className="documentos-monthly-cards">
              {(["SIMPLES", "FGTS"] as DocumentMonthlyObligationType[]).map((type) => {
                const latest = latestMonthlyByType[type];
                const status = latest ? computeMonthlyFilesStatus(latest) : "empty";
                const canDownload = status === "complete";
                const statusLabel =
                  status === "complete" ? "Concluído" : status === "partial" ? "Pendente" : "Sem arquivo";
                return (
                  <article key={`monthly-card-${type}`} className="documentos-monthly-card">
                    <div className="documentos-monthly-card-header">
                      <h4>{MONTHLY_OBLIGATION_LABELS[type]}</h4>
                      <span className={`documentos-monthly-status is-${status}`}>{statusLabel}</span>
                    </div>
                    <p className="documentos-monthly-card-line">
                      <span>Competência</span>
                      <strong>{latest ? formatMonthRef(latest.competency) : "-"}</strong>
                    </p>
                    <p className="documentos-monthly-card-line">
                      <span>Vencimento</span>
                      <strong>{latest ? formatMonthlyDueDate(latest.competency) : "-"}</strong>
                    </p>
                    <p className="documentos-monthly-card-line is-concluded-at">
                      <span>Concluído em</span>
                      <strong>{status === "complete" && latest?.updatedAt ? new Date(latest.updatedAt).toLocaleString("pt-BR") : "-"}</strong>
                    </p>
                    <div className="documentos-monthly-card-footer">
                      <small className="muted-text">Use o botão Novo para registrar a próxima competência.</small>
                      {canDownload && latest ? (
                        <button
                          type="button"
                          className="primary-button documentos-certificado-button documentos-monthly-download-button"
                          onClick={() =>
                            void withDownloadFeedback(
                              () =>
                                downloadMonthlyCombinedObligation({
                                  cnpj: resolveDownloadCnpj(cnpj, latest.cnpj),
                                  obligationType: latest.obligationType,
                                  competency: latest.competency,
                                }),
                              "Falha ao baixar PDF consolidado da obrigação mensal.",
                            )
                          }
                        >
                          <DownloadIcon />
                          Baixar
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="transaction-table-wrap">
              <table className="transaction-data-table">
                <thead>
                  <tr>
                    <th>Obrigação</th>
                    <th>Competência</th>
                    <th>Status</th>
                    <th>Arquivos</th>
                    <th>Última atualização</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyLoading ? (
                    <tr>
                      <td colSpan={6}>Carregando obrigações mensais...</td>
                    </tr>
                  ) : monthlyItems.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Nenhum arquivo mensal cadastrado.</td>
                    </tr>
                  ) : (
                    monthlyItems.map((item) => {
                      const status = computeMonthlyFilesStatus(item);
                      const statusLabel = status === "complete" ? "Concluído" : status === "partial" ? "Pendente" : "Sem arquivo";
                      const filesCount =
                        item.uploadMode === "single"
                          ? Number(Boolean(item.singleStoragePath))
                          : Number(Boolean(item.boletoStoragePath)) + Number(Boolean(item.receiptStoragePath));
                      return (
                        <tr key={`monthly-${item.obligationType}-${item.competency}`}>
                          <td>{MONTHLY_OBLIGATION_LABELS[item.obligationType]}</td>
                          <td>{formatMonthRef(item.competency)}</td>
                          <td>
                            <span className={`documentos-monthly-status is-${status}`}>{statusLabel}</span>
                          </td>
                          <td>{`${filesCount} arquivo(s)`}</td>
                          <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString("pt-BR") : "-"}</td>
                          <td>
                            <div className="row">
                              <button
                                type="button"
                                className="transaction-icon-button"
                                onClick={() => openMonthlyModal(item.obligationType, item)}
                                title="Editar"
                                aria-label="Editar"
                              >
                                <EditIcon />
                              </button>
                              <button
                                type="button"
                                className="transaction-icon-button danger"
                                onClick={() => void onDeleteMonthly(item)}
                                title="Excluir"
                                aria-label="Excluir"
                              >
                                <TrashIcon />
                              </button>
                              {status === "complete" ? (
                                <button
                                  type="button"
                                  className="transaction-icon-button"
                                  onClick={() =>
                                    void withDownloadFeedback(
                                      () =>
                                        downloadMonthlyCombinedObligation({
                                          cnpj: resolveDownloadCnpj(cnpj, item.cnpj),
                                          obligationType: item.obligationType,
                                          competency: item.competency,
                                        }),
                                      "Falha ao baixar PDF consolidado da obrigação mensal.",
                                    )
                                  }
                                  title={`Baixar PDF consolidado de ${MONTHLY_OBLIGATION_LABELS[item.obligationType]} (${formatMonthRef(item.competency)})`}
                                  aria-label={`Baixar PDF único consolidado de ${MONTHLY_OBLIGATION_LABELS[item.obligationType]} em ${formatMonthRef(item.competency)}`}
                                >
                                  <DownloadIcon />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card" hidden={activeTab !== "nfse"}>
            <div className="section-header-row">
              <h3 className="documentos-title-with-icon">
                <SectionNfseIcon />
                <span>Emissão NFS-e</span>
              </h3>
            </div>
            {nfseReminder ? <p className="documentos-nfse-reminder">{nfseReminder}</p> : null}
            <div className="documentos-nfse-templates">
              {(Object.keys(NFSE_TEMPLATE_OPTIONS) as DocumentNfseTemplateKey[]).map((key) => {
                const template = NFSE_TEMPLATE_OPTIONS[key];
                const selected = nfseTemplate === key;
                return (
                  <button
                    key={`nfse-template-${key}`}
                    type="button"
                    className={`documentos-nfse-template-card ${selected ? "is-selected" : ""}`}
                    onClick={() => setNfseTemplate(key)}
                  >
                    <strong>{template.label}</strong>
                    <span>{template.tomador}</span>
                    <small>{`${template.issMode} - referência dia ${template.referenceDay}`}</small>
                  </button>
                );
              })}
            </div>
            <div className="documentos-nfse-form-grid">
              <label>
                Descrição do serviço
                <textarea
                  value={nfseDescription}
                  onChange={(event) => setNfseDescription(event.target.value)}
                  placeholder={selectedNfseTemplate.descriptionPlaceholder}
                  rows={3}
                />
              </label>
              <label>
                Valor
                <input
                  type="text"
                  inputMode="decimal"
                  value={nfseAmount}
                  onChange={(event) => setNfseAmount(event.target.value)}
                  placeholder="0,00"
                />
              </label>
              <label>
                Competência
                <input type="month" value={nfseCompetency} onChange={(event) => setNfseCompetency(event.target.value)} />
              </label>
            </div>
            <div className="documentos-nfse-actions">
              <div className="row">
                <button type="button" className="primary-button" onClick={() => void onOpenNfseEmission()} disabled={nfseSaving}>
                  {nfseSaving ? "Salvando..." : "Abrir emissão no WebISS"}
                </button>
                <a
                  className="documentos-nfse-open-link"
                  href="https://nossasenhoradosocorrose.webiss.com.br/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir portal manualmente
                </a>
                <label className="documentos-nfse-import-label">
                  <input type="file" accept=".xml,text/xml" multiple onChange={(event) => void onImportNfseXmlFiles(event)} disabled={nfseImporting} />
                  <span>{nfseImporting ? "Importando XML..." : "Importar XMLs emitidos"}</span>
                </label>
              </div>
              <small className="muted-text">
                Fluxo assistido: preencha descrição e valor para abrir o portal da Prefeitura de Nossa Senhora do Socorro/SE.
              </small>
            </div>
            <div className="documentos-nfse-summary-row">
              <label>
                Resumo do mês
                <input type="month" value={nfseSummaryMonth} onChange={(event) => setNfseSummaryMonth(event.target.value)} />
              </label>
              <div className="documentos-nfse-summary-cards">
                <article className="documentos-nfse-summary-card">
                  <span>Previsto x emitido</span>
                  <strong>{`${nfseSummary.emitted}/${nfseSummary.expected}`}</strong>
                </article>
                <article className="documentos-nfse-summary-card">
                  <span>Valor previsto</span>
                  <strong>{nfseSummary.preparedTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>
                </article>
                <article className="documentos-nfse-summary-card">
                  <span>Valor emitido</span>
                  <strong>{nfseSummary.emittedTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>
                </article>
              </div>
            </div>
            <div className="documentos-nfse-filters">
              <label>
                Modelo
                <select
                  value={nfseFilterTemplate}
                  onChange={(event) => setNfseFilterTemplate(event.target.value as "ALL" | DocumentNfseTemplateKey)}
                >
                  <option value="ALL">Todos</option>
                  <option value="DIA_5_RETIDO">Dia 5</option>
                  <option value="DIA_20_SEM_RETENCAO">Dia 20</option>
                </select>
              </label>
              <label>
                Status
                <select
                  value={nfseFilterStatus}
                  onChange={(event) => setNfseFilterStatus(event.target.value as "ALL" | "preparada" | "emitida")}
                >
                  <option value="ALL">Todos</option>
                  <option value="preparada">Preparada</option>
                  <option value="emitida">Emitida</option>
                </select>
              </label>
              <label>
                Busca
                <input
                  value={nfseFilterSearch}
                  onChange={(event) => setNfseFilterSearch(event.target.value)}
                  placeholder="Tomador, descrição ou número da nota"
                />
              </label>
            </div>
            <div className="transaction-table-wrap">
              <table className="transaction-data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Competência</th>
                    <th>Modelo</th>
                    <th>Tomador</th>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {nfseLoading ? (
                    <tr>
                      <td colSpan={8}>Carregando histórico de emissão...</td>
                    </tr>
                  ) : filteredNfseItems.length === 0 ? (
                    <tr>
                      <td colSpan={8}>Nenhuma emissão registrada para os filtros informados.</td>
                    </tr>
                  ) : (
                    filteredNfseItems.map((item) => (
                      <tr key={`nfse-draft-${item.id}`}>
                        <td>{new Date(item.emittedAt ?? item.createdAt).toLocaleString("pt-BR")}</td>
                        <td>{formatMonthInputToLabel(item.competency)}</td>
                        <td>{NFSE_TEMPLATE_OPTIONS[item.templateKey]?.label ?? item.templateKey}</td>
                        <td>{item.tomadorLabel}</td>
                        <td className="documentos-nfse-description-cell">{item.serviceDescription}</td>
                        <td>{item.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                        <td>{item.status === "emitida" ? `Emitida${item.invoiceNumber ? ` #${item.invoiceNumber}` : ""}` : "Preparada"}</td>
                        <td>
                          <div className="row">
                            <button
                              type="button"
                              className="transaction-icon-button"
                              onClick={() => openNfseEmitModal(item)}
                              title={item.status === "emitida" ? "Atualizar emissão" : "Marcar como emitida"}
                              aria-label={item.status === "emitida" ? "Atualizar emissão" : "Marcar como emitida"}
                            >
                              <EditIcon />
                            </button>
                            {item.xmlStoragePath ? (
                              <button
                                type="button"
                                className="transaction-icon-button"
                                onClick={() =>
                                  void withDownloadFeedback(
                                    () =>
                                      downloadNfseDraftAttachment({
                                        id: item.id,
                                        cnpj: resolveDownloadCnpj(cnpj, item.cnpj),
                                        kind: "xml",
                                      }),
                                    "Falha ao baixar XML da NFS-e.",
                                  )
                                }
                                title="Baixar XML"
                                aria-label="Baixar XML"
                              >
                                <DownloadIcon />
                              </button>
                            ) : null}
                            {item.pdfStoragePath ? (
                              <button
                                type="button"
                                className="transaction-icon-button"
                                onClick={() =>
                                  void withDownloadFeedback(
                                    () =>
                                      downloadNfseDraftAttachment({
                                        id: item.id,
                                        cnpj: resolveDownloadCnpj(cnpj, item.cnpj),
                                        kind: "pdf",
                                      }),
                                    "Falha ao baixar PDF da NFS-e.",
                                  )
                                }
                                title="Baixar PDF"
                                aria-label="Baixar PDF"
                              >
                                <DownloadIcon />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
      </>

      {nfseEditModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>{nfseEditTarget?.status === "emitida" ? "Atualizar emissão NFS-e" : "Marcar NFS-e como emitida"}</h2>
              <button
                type="button"
                onClick={() => {
                  setNfseEditModalOpen(false);
                  setNfseEditTarget(null);
                }}
              >
                X
              </button>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveNfseEmitted();
              }}
            >
              <label>
                Número da NFS-e
                <input value={nfseInvoiceNumber} onChange={(event) => setNfseInvoiceNumber(event.target.value)} required />
              </label>
              <label>
                Código de verificação
                <input value={nfseVerificationCode} onChange={(event) => setNfseVerificationCode(event.target.value)} required />
              </label>
              <label>
                Data/Hora da emissão
                <input type="datetime-local" value={nfseEmittedAt} onChange={(event) => setNfseEmittedAt(event.target.value)} />
              </label>
              <label>
                XML da NFS-e (opcional)
                <input type="file" accept=".xml,text/xml" onChange={(event) => void onNfseXmlChange(event)} />
              </label>
              {nfseXmlFileName ? <small className="muted-text">XML selecionado: {nfseXmlFileName}</small> : null}
              <label>
                PDF da NFS-e (opcional)
                <input type="file" accept=".pdf" onChange={(event) => void onNfsePdfChange(event)} />
              </label>
              {nfsePdfFileName ? <small className="muted-text">PDF selecionado: {nfsePdfFileName}</small> : null}
              <div className="modal-actions">
                <button type="submit" className="primary-button" disabled={nfseMarkingEmitted}>
                  {nfseMarkingEmitted ? "Salvando..." : "Salvar emissão"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNfseEditModalOpen(false);
                    setNfseEditTarget(null);
                  }}
                  disabled={nfseMarkingEmitted}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isConfigModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Adicionar Certificado</h2>
              <button type="button" onClick={() => setIsConfigModalOpen(false)}>
                X
              </button>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveConfig();
              }}
            >
              <label>
                CNPJ
                <input
                  value={formatCnpj(cnpj)}
                  onChange={(event) => setCnpj(event.target.value)}
                  placeholder="00.000.000/0000-00"
                  required
                />
              </label>
              <label>
                Certificado digital
                <input type="file" accept=".pfx,.p12,.pem,.crt" onChange={(event) => void onCertificateFileChange(event)} />
              </label>
              <label>
                Senha do certificado
                <input type="password" value={certificatePassword} onChange={(event) => setCertificatePassword(event.target.value)} />
              </label>
              <small className="muted-text">
                {certificateExpiresAt
                  ? `Validade atual: ${certificateExpiryInfo}`
                  : "A validade será lida automaticamente do certificado enviado."}
              </small>
              <div className="modal-actions">
                <button type="submit" className="primary-button" disabled={savingConfig}>
                  {savingConfig ? "Salvando..." : "Salvar configuração"}
                </button>
                <button type="button" onClick={() => setIsConfigModalOpen(false)} disabled={savingConfig}>
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {monthlyModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>{monthlyEditingItem ? "Editar obrigação mensal" : "Obrigações mensais"}</h2>
              <button
                type="button"
                onClick={() => {
                  setMonthlyEditingItem(null);
                  setMonthlyModalOpen(false);
                }}
              >
                X
              </button>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveMonthly();
              }}
            >
              <div className="documentos-monthly-meta-grid">
                <label>
                  Tipo
                  <select value={monthlyType} onChange={(event) => setMonthlyType(event.target.value as DocumentMonthlyObligationType)}>
                    <option value="SIMPLES">Simples Nacional</option>
                    <option value="FGTS">FGTS</option>
                  </select>
                </label>
                <label>
                  Competência
                  <input type="month" value={monthlyCompetency} onChange={(event) => setMonthlyCompetency(event.target.value)} required />
                </label>
              </div>
              <label>
                Forma de envio
                <select value={monthlyUploadMode} onChange={(event) => setMonthlyUploadMode(event.target.value as DocumentMonthlyUploadMode)}>
                  <option value="single">Arquivo único</option>
                  <option value="separate">Arquivos separados (Boleto + comprovante)</option>
                </select>
              </label>
              {monthlyUploadMode === "single" ? (
                <>
                  {monthlyEditingItem?.singleStoragePath && !monthlySingleBase64 ? (
                    <div className="documentos-monthly-file-current-row">
                      <button
                        type="button"
                        className="documentos-monthly-file-link"
                        onClick={() =>
                          void withDownloadFeedback(
                            () =>
                              downloadMonthlyObligation({
                                cnpj: resolveDownloadCnpj(cnpj, monthlyEditingItem.cnpj),
                                obligationType: monthlyEditingItem.obligationType,
                                competency: monthlyEditingItem.competency,
                                kind: "single",
                              }),
                            "Falha ao baixar arquivo mensal.",
                          )
                        }
                      >
                        {monthlyEditingItem.singleFileName ?? "Arquivo atual"}
                      </button>
                      <button
                        type="button"
                        className="transaction-icon-button danger"
                        onClick={() => onRemoveMonthlyExistingFile("single")}
                        title="Excluir arquivo atual"
                        aria-label="Excluir arquivo atual"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ) : null}
                  {monthlyShowSingleUploadInput ? (
                  <label>
                    Arquivo único
                    <input type="file" accept=".pdf,image/*" onChange={(event) => void onMonthlySingleFileChange(event)} />
                  </label>
                  ) : null}
                  {monthlySingleFileName ? <small className="muted-text">Arquivo selecionado: {monthlySingleFileName}</small> : null}
                </>
              ) : (
                <>
                  {monthlyEditingItem?.boletoStoragePath && !monthlyBoletoBase64 ? (
                    <div className="documentos-monthly-file-current-row">
                      <button
                        type="button"
                        className="documentos-monthly-file-link"
                        onClick={() =>
                          void withDownloadFeedback(
                            () =>
                              downloadMonthlyObligation({
                                cnpj: resolveDownloadCnpj(cnpj, monthlyEditingItem.cnpj),
                                obligationType: monthlyEditingItem.obligationType,
                                competency: monthlyEditingItem.competency,
                                kind: "boleto",
                              }),
                            "Falha ao baixar boleto mensal.",
                          )
                        }
                      >
                        {monthlyEditingItem.boletoFileName ?? "Boleto atual"}
                      </button>
                      <button
                        type="button"
                        className="transaction-icon-button danger"
                        onClick={() => onRemoveMonthlyExistingFile("boleto")}
                        title="Excluir boleto atual"
                        aria-label="Excluir boleto atual"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ) : null}
                  {monthlyShowBoletoUploadInput ? (
                    <label>
                      Boleto
                      <input type="file" accept=".pdf,image/*" onChange={(event) => void onMonthlyBoletoFileChange(event)} />
                    </label>
                  ) : null}
                  {monthlyBoletoFileName ? <small className="muted-text">Boleto: {monthlyBoletoFileName}</small> : null}
                  {monthlyEditingItem?.receiptStoragePath && !monthlyReceiptBase64 ? (
                    <div className="documentos-monthly-file-current-row">
                      <button
                        type="button"
                        className="documentos-monthly-file-link"
                        onClick={() =>
                          void withDownloadFeedback(
                            () =>
                              downloadMonthlyObligation({
                                cnpj: resolveDownloadCnpj(cnpj, monthlyEditingItem.cnpj),
                                obligationType: monthlyEditingItem.obligationType,
                                competency: monthlyEditingItem.competency,
                                kind: "receipt",
                              }),
                            "Falha ao baixar comprovante mensal.",
                          )
                        }
                      >
                        {monthlyEditingItem.receiptFileName ?? "Comprovante atual"}
                      </button>
                      <button
                        type="button"
                        className="transaction-icon-button danger"
                        onClick={() => onRemoveMonthlyExistingFile("receipt")}
                        title="Excluir comprovante atual"
                        aria-label="Excluir comprovante atual"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ) : null}
                  {monthlyShowReceiptUploadInput ? (
                    <label>
                      Comprovante
                      <input type="file" accept=".pdf,image/*" onChange={(event) => void onMonthlyReceiptFileChange(event)} />
                    </label>
                  ) : null}
                  {monthlyReceiptFileName ? <small className="muted-text">Comprovante: {monthlyReceiptFileName}</small> : null}
                </>
              )}
              <small className="muted-text">Dica: no modo separado, você pode enviar só 1 arquivo e completar depois.</small>
              <div className="modal-actions">
                <button type="submit" className="primary-button" disabled={monthlySaving}>
                  {monthlySaving ? "Salvando..." : monthlyEditingItem ? "Salvar alterações" : "Salvar obrigação mensal"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMonthlyEditingItem(null);
                    setMonthlyModalOpen(false);
                  }}
                  disabled={monthlySaving}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {manualModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Registrar manualmente</h2>
              <button type="button" onClick={() => setManualModalOpen(false)}>
                X
              </button>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveManual();
              }}
            >
              <label>
                Tipo
                <input value={CERT_LABELS[manualCertType]} disabled />
              </label>
              <label>
                Emissão
                <input type="date" value={manualIssueDate} onChange={(event) => setManualIssueDate(event.target.value)} required />
              </label>
              <label>
                Validade
                <input type="date" value={manualExpiryDate} onChange={(event) => setManualExpiryDate(event.target.value)} required />
              </label>
              <label>
                Código de controle
                <input value={manualControlCode} onChange={(event) => setManualControlCode(event.target.value)} required />
              </label>
              <label>
                URL da certidão (opcional)
                <input value={manualSourceUrl} onChange={(event) => setManualSourceUrl(event.target.value)} placeholder="https://..." />
              </label>
              <label>
                PDF da certidão (opcional)
                <input type="file" accept="application/pdf,.pdf" onChange={(event) => void onManualPdfChange(event)} />
              </label>
              {manualPdfName ? <small className="muted-text">Arquivo selecionado: {manualPdfName}</small> : null}
              {manualExtractInfo ? <small className={`documentos-extract-feedback is-${manualExtractTone}`}>{manualExtractInfo}</small> : null}
              <div className="modal-actions">
                <button type="submit" className="primary-button" disabled={manualSaving || manualExtractingPdf}>
                  {manualSaving ? "Salvando..." : manualExtractingPdf ? "Lendo PDF..." : "Salvar manual"}
                </button>
                <button type="button" onClick={() => setManualModalOpen(false)} disabled={manualSaving || manualExtractingPdf}>
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {message ? <p className="copy-feedback">{message}</p> : null}
    </div>
  );
}
