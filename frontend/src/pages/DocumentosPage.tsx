import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { DocumentCertidao, DocumentCertidaoStatus, DocumentCertidaoTipo } from "../types";
import {
  downloadCertidao,
  getCertidoesStatus,
  refreshCertidoes,
  registerManualCertidao,
  saveCertificateConfig,
} from "../services/documentsApi";

const CERT_LABELS: Record<DocumentCertidaoTipo, string> = {
  CNDT: "CNDT - TST",
  CNF: "CNF - Tributos Federais e Dívida Ativa",
  CRF: "CRF - FGTS",
};

const CERT_PORTAL_URL: Record<DocumentCertidaoTipo, string> = {
  CNDT: "https://cndt-certidao.tst.jus.br/inicio.faces",
  CNF: "https://solucoes.receita.fazenda.gov.br/Servicos/certidao/",
  CRF: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf",
};

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

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, "");
}

function formatCnpj(value: string): string {
  const digits = normalizeCnpj(value).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function computeStatusLabel(status: DocumentCertidaoStatus): string {
  if (status === "valida") return "Válida";
  if (status === "vencendo") return "Vencendo";
  if (status === "vencida") return "Vencida";
  if (status === "falha") return "Falha";
  return "Pendente";
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
  const [activeTab, setActiveTab] = useState<"certidoes" | "biblioteca">("certidoes");
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
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualCertType, setManualCertType] = useState<DocumentCertidaoTipo>("CRF");
  const [manualIssueDate, setManualIssueDate] = useState(todayIsoDate());
  const [manualExpiryDate, setManualExpiryDate] = useState("");
  const [manualControlCode, setManualControlCode] = useState("");
  const [manualSourceUrl, setManualSourceUrl] = useState("");
  const [manualPdfName, setManualPdfName] = useState("");
  const [manualPdfBase64, setManualPdfBase64] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [message, setMessage] = useState("");

  const certificateExpiryInfo = useMemo(() => computeCertificateExpiryInfo(certificateExpiresAt || null), [certificateExpiresAt]);
  const certificateExpiryTone = useMemo(() => computeCertificateExpiryTone(certificateExpiresAt || null), [certificateExpiresAt]);

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
  };

  const openManualModal = (certType: DocumentCertidaoTipo) => {
    setManualCertType(certType);
    setManualIssueDate(todayIsoDate());
    setManualExpiryDate("");
    setManualControlCode("");
    setManualSourceUrl("");
    setManualPdfName("");
    setManualPdfBase64("");
    setManualModalOpen(true);
  };

  const onSaveManual = async () => {
    const normalized = normalizeCnpj(cnpj);
    if (normalized.length !== 14) {
      setMessage("Informe um CNPJ válido para registrar manualmente.");
      return;
    }
    if (!manualExpiryDate) {
      setMessage("Informe a validade da certidão manual.");
      return;
    }
    setManualSaving(true);
    try {
      const data = await registerManualCertidao({
        cnpj: normalized,
        certType: manualCertType,
        issueDate: manualIssueDate || undefined,
        expiryDate: manualExpiryDate,
        controlCode: manualControlCode || undefined,
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
    setRefreshing(true);
    try {
      const data = await refreshCertidoes({ cnpj: normalized, certTypes: targetTypes });
      setCertidoes(data.items);
      setMessage("Atualização manual concluída. Créditos consumidos conforme as certidões consultadas.");
    } catch {
      setMessage("Falha ao atualizar certidões.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="financeiro-page">
      <section className="card">
        <div className="section-header-row">
          <h2>Documentos</h2>
          <div className="row">
            <button type="button" className={`nav-tab ${activeTab === "certidoes" ? "active" : ""}`} onClick={() => setActiveTab("certidoes")}>
              Certidões
            </button>
            <button type="button" className={`nav-tab ${activeTab === "biblioteca" ? "active" : ""}`} onClick={() => setActiveTab("biblioteca")}>
              Biblioteca
            </button>
          </div>
        </div>
      </section>

      {activeTab === "certidoes" ? (
        <>
          <section className="card">
            <div className="section-header-row">
              <h3>Certidões monitoradas</h3>
              <div className="row">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setIsConfigModalOpen(true)}
                >
                  Adicionar Certificado
                </button>
                <span className={`cert-expiry-badge cert-expiry-badge-${certificateExpiryTone}`}>
                  {certificateExpiresAt ? certificateExpiryInfo : "Sem certificado cadastrado."}
                </span>
                <button type="button" className="primary-button" onClick={() => void onRefresh()} disabled={refreshing || loading}>
                  {refreshing ? "Atualizando..." : "Atualizar agora"}
                </button>
              </div>
            </div>
            <p className="documentos-refresh-note">
              Atualização sob demanda: o sistema só consulta CNDT, CNF e CRF quando você clicar em atualizar (consome créditos).
            </p>
            <table className="transaction-data-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Emissão</th>
                  <th>Validade</th>
                  <th>Última verificação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6}>Carregando certidões...</td>
                  </tr>
                ) : certidoes.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Informe o CNPJ para carregar as certidões.</td>
                  </tr>
                ) : (
                  certidoes.map((item) => (
                    <tr key={`cert-${item.certType}`}>
                      <td>{CERT_LABELS[item.certType]}</td>
                      <td>{computeStatusLabel(item.status)}</td>
                      <td>{item.issueDate ? new Date(`${item.issueDate}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                      <td>{item.expiryDate ? new Date(`${item.expiryDate}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                      <td>{item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString("pt-BR") : "-"}</td>
                      <td>
                        <div className="row">
                          <button
                            type="button"
                            className="transaction-icon-button"
                            onClick={() => void onRefresh([item.certType])}
                          >
                            Atualizar
                          </button>
                          <button
                            type="button"
                            className="transaction-icon-button"
                            onClick={() => void downloadCertidao(normalizeCnpj(cnpj), item.certType)}
                            disabled={!item.storagePath}
                          >
                            Baixar
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
                        </div>
                        {item.lastError ? <small className="error-text">{normalizeCertErrorMessage(item.lastError)}</small> : null}
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
                  ))
                )}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <section className="card">
          <div className="section-header-row">
            <h3>Biblioteca</h3>
          </div>
          <p className="section-subtitle">Submódulo de biblioteca de documentos será integrado na próxima etapa.</p>
        </section>
      )}

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
                <input type="date" value={manualIssueDate} onChange={(event) => setManualIssueDate(event.target.value)} />
              </label>
              <label>
                Validade
                <input type="date" value={manualExpiryDate} onChange={(event) => setManualExpiryDate(event.target.value)} required />
              </label>
              <label>
                Código de controle (opcional)
                <input value={manualControlCode} onChange={(event) => setManualControlCode(event.target.value)} />
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
              <div className="modal-actions">
                <button type="submit" className="primary-button" disabled={manualSaving}>
                  {manualSaving ? "Salvando..." : "Salvar manual"}
                </button>
                <button type="button" onClick={() => setManualModalOpen(false)} disabled={manualSaving}>
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
