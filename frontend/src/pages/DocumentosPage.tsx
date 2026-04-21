import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { DocumentCertidao, DocumentCertidaoStatus, DocumentCertidaoTipo } from "../types";
import {
  downloadCertidao,
  extractManualCertidaoData,
  getCertidoesStatus,
  refreshCertidoes,
  registerManualCertidao,
  saveCertificateConfig,
} from "../services/documentsApi";

const CERT_LABELS: Record<DocumentCertidaoTipo, string> = {
  CNDT: "CNDT - TST - CERTIDÃO NEGATIVA DE DÉBITOS TRABALHISTAS",
  CNF: "CNF - CERTIDÃO NEGATIVA DÉBITOS TRIBUTOS FEDERAIS E DIVIDA ATIVA UNIÃO",
  CRF: "CRF - FGTS - CERTIFICADO DE REGULARIDADE DO FGTS",
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

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
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

function computeStatusClassName(status: DocumentCertidaoStatus): string {
  if (status === "vencida") return "documentos-status-vencida";
  return "";
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
              <h3>Certidões</h3>
            </div>
            <div className="row documentos-certificado-row">
              <button
                type="button"
                className="primary-button documentos-certificado-button"
                onClick={() => setIsConfigModalOpen(true)}
              >
                Adicionar Certificado
              </button>
              <span className={`cert-expiry-badge documentos-certificado-badge cert-expiry-badge-${certificateExpiryTone}`}>
                {certificateExpiresAt ? certificateExpiryInfo : "Sem certificado cadastrado."}
              </span>
            </div>
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
                  certidoes.map((item) => (
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
                            aria-label="Atualizar"
                            title="Atualizar"
                          >
                            <RefreshIcon />
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
                            onClick={() => void downloadCertidao(normalizeCnpj(cnpj), item.certType)}
                            disabled={!item.storagePath}
                            aria-label="Baixar"
                            title="Baixar"
                          >
                            <DownloadIcon />
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
