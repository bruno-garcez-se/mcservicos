import { CertidoesRunner, CertidoesRunnerInput } from "./certidoes.runner";
import { CertidaoProviderPayload } from "../certidoes.types";
import { Browser, BrowserContext, chromium } from "playwright";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function pickString(source: JsonRecord | null, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ptBr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(trimmed);
  if (ptBr) return `${ptBr[3]}-${ptBr[2]}-${ptBr[1]}`;
  return null;
}

function normalizeCnpjDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function extractDatesFromText(text: string): string[] {
  const matches = text.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) ?? [];
  return [...new Set(matches)];
}

function toIsoDate(ptBrDate: string | null): string | null {
  if (!ptBrDate) return null;
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ptBrDate.trim());
  if (!parts) return null;
  return `${parts[3]}-${parts[2]}-${parts[1]}`;
}

function mapPlaywrightError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();
  if (
    lower.includes("executable doesn't exist") ||
    lower.includes("playwright install") ||
    lower.includes("browser not found")
  ) {
    return "Automação CRF indisponível no servidor: navegador Playwright não instalado neste ambiente.";
  }
  if (lower.includes("timed out")) {
    return "Automação CRF expirou por tempo limite no portal. Tente novamente.";
  }
  return `Falha na automação CRF: ${message}`;
}

function containsAny(text: string, needles: string[]): boolean {
  const normalized = text.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function stringifyRaw(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractFirstDataRow(response: JsonRecord | null): JsonRecord | null {
  if (!response) return null;
  const data = response.data;
  if (Array.isArray(data)) {
    const first = data[0];
    return asRecord(first);
  }
  return asRecord(data);
}

function extractApiError(response: JsonRecord | null): string | null {
  if (!response) return "Resposta inválida do provedor online.";
  const explicitError = pickString(response, [
    "error",
    "errorMessage",
    "message",
    "message_code",
    "code_message",
  ]);
  if (explicitError) return explicitError;
  const errors = response.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (typeof first === "string" && first.trim()) return first.trim();
    const firstObj = asRecord(first);
    if (firstObj) {
      const msg = pickString(firstObj, ["message", "error", "description"]);
      if (msg) return msg;
    }
  }
  return null;
}

async function fetchFromInfoSimples(input: CertidoesRunnerInput): Promise<CertidaoProviderPayload> {
  const token = (process.env.CERTIDOES_INFOSIMPLES_TOKEN || "").trim();
  if (!token) {
    return {
      ok: false,
      errorMessage:
        "Integração online não configurada. Defina CERTIDOES_INFOSIMPLES_TOKEN no backend para atualizar certidões reais.",
    };
  }

  const InfoSimplesModule = await import("infosimples-sdk");
  const connect =
    typeof InfoSimplesModule.connect === "function"
      ? InfoSimplesModule.connect
      : typeof InfoSimplesModule.default?.connect === "function"
        ? InfoSimplesModule.default.connect
        : null;
  if (!connect) {
    return {
      ok: false,
      errorMessage: "Falha ao inicializar integração InfoSimples.",
    };
  }

  const client = connect({ token });
  let responseUnknown: unknown;
  if (input.certType === "CNDT") {
    responseUnknown = await client.tribunais.tstCndt({ cnpj: input.cnpj, cpf: "" });
  } else if (input.certType === "CNF") {
    responseUnknown = await client.receitaFederal.pgfn({
      cnpj: input.cnpj,
      preferencia_emissao: "2via",
    });
  } else {
    responseUnknown = await client.caixa.regularidadeEmpregador({ cnpj: input.cnpj });
  }

  const response = asRecord(responseUnknown);
  const dataRow = extractFirstDataRow(response);
  const apiCode = Number(response?.code ?? 0);
  const apiMessage = extractApiError(response);
  const isOk = Boolean(dataRow) && (apiCode === 0 || apiCode === 200 || apiCode === 201);
  if (!isOk) {
    return {
      ok: false,
      errorMessage: apiMessage || "Falha ao consultar certidão no provedor online.",
      rawText: stringifyRaw(responseUnknown),
    };
  }

  const issueDate = normalizeDate(
    pickString(dataRow, [
      "issue_date",
      "data_emissao",
      "emissao_data",
      "validade_inicio_data",
      "inicio_validade",
    ]),
  );
  const expiryDate = normalizeDate(
    pickString(dataRow, ["expiry_date", "data_validade", "validade_data", "validade_fim_data", "fim_validade"]),
  );
  const controlCode = pickString(dataRow, [
    "control_code",
    "codigo_controle",
    "certidao_codigo",
    "numero_certidao",
    "numero",
  ]);
  const sourceUrl = pickString(dataRow, ["source_url", "url", "consulta_url"]);
  const rawPdf = pickString(dataRow, [
    "pdf_base64",
    "certidao_pdf_base64",
    "arquivo_pdf_base64",
    "pdf",
  ]);
  const pdfBase64 = rawPdf && !rawPdf.startsWith("http") ? rawPdf : null;

  return {
    ok: true,
    issueDate,
    expiryDate,
    controlCode,
    sourceUrl,
    pdfBase64,
    rawText: stringifyRaw(dataRow),
  };
}

async function fetchCrfWithPlaywright(cnpj: string): Promise<CertidaoProviderPayload> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      locale: "pt-BR",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    const timeoutMs = Number(process.env.CERTIDOES_PLAYWRIGHT_TIMEOUT_MS || 60000);
    const response = await page.goto(
      "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf",
      {
        waitUntil: "networkidle",
        timeout: timeoutMs,
      },
    );
    if (!response || response.status() >= 400) {
      return {
        ok: false,
        errorMessage: `Portal CRF indisponível no momento (HTTP ${response?.status() ?? "n/a"}).`,
      };
    }
    const currentUrl = page.url().toLowerCase();
    const pageTitle = (await page.title()).toLowerCase();
    if (
      currentUrl.includes("validate.perfdrive.com") ||
      pageTitle.includes("shieldsquare") ||
      pageTitle.includes("block")
    ) {
      return {
        ok: false,
        errorMessage: "Portal CRF bloqueou a automação por proteção anti-bot (ShieldSquare).",
        sourceUrl: page.url(),
      };
    }
    const cnpjDigits = normalizeCnpjDigits(cnpj);
    const selectInscriptionType = page.locator(
      "select[id*='tipoInscricao'], select[name*='tipoInscricao'], select:has(option:text-is('CNPJ'))",
    );
    if ((await selectInscriptionType.count()) > 0) {
      const select = selectInscriptionType.first();
      try {
        await select.selectOption({ label: "CNPJ" });
      } catch {
        // alguns ambientes já iniciam em CNPJ; ignora se não conseguir trocar
      }
    }

    const cnpjInput = page
      .locator(
        "input#mainForm\\:txtInscricao1, input[name='mainForm:txtInscricao1'], input[id*='inscricao'], input[name*='inscricao'], input[placeholder*='Inscrição'], input[placeholder*='Inscricao']",
      )
      .first();
    if ((await cnpjInput.count()) === 0) {
      return {
        ok: false,
        errorMessage: "Não foi possível localizar o campo de CNPJ no portal CRF (layout/bloqueio).",
        sourceUrl: page.url(),
      };
    }
    await cnpjInput.fill(cnpjDigits);

    const submitButton = page
      .locator("button, input[type='submit'], a")
      .filter({ hasText: /consultar|pesquisar|emitir|continuar/i })
      .first();
    if ((await submitButton.count()) > 0) {
      await submitButton.click({ timeout: 10000 });
    } else {
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(2500);
    const initialResultText = await page.locator("body").innerText().catch(() => "");
    const initialLower = initialResultText.toLowerCase();
    if (
      containsAny(initialLower, ["captcha", "recaptcha", "acesso negado", "forbidden", "shieldsquare"])
    ) {
      return {
        ok: false,
        errorMessage: "Portal CRF bloqueou a automação (captcha/antibot).",
        rawText: initialResultText.slice(0, 6000),
      };
    }
    if (
      containsAny(initialLower, [
        "não regular",
        "nao regular",
        "não foi possível localizar",
        "nao foi possivel localizar",
      ])
    ) {
      return {
        ok: false,
        errorMessage: "Empresa não regular ou CNPJ não localizado no CRF.",
        rawText: initialResultText.slice(0, 6000),
      };
    }

    const certLink = page
      .locator("a")
      .filter({ hasText: /Certificado de Regularidade do FGTS\s*-\s*CRF/i })
      .first();
    if ((await certLink.count()) === 0) {
      return {
        ok: false,
        errorMessage: "Consulta CRF não retornou o link do certificado.",
        rawText: initialResultText.slice(0, 6000),
        sourceUrl: page.url(),
      };
    }

    const popupPromise = context.waitForEvent("page", { timeout: 7000 }).catch(() => null);
    await certLink.click({ timeout: 10000 });
    const certPage = (await popupPromise) || page;
    if (certPage !== page) {
      await certPage.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
    }

    const visualButton = certPage
      .locator("a, button, input[type='submit']")
      .filter({ hasText: /visualizar/i })
      .first();
    if ((await visualButton.count()) > 0) {
      const viewPopupPromise = context.waitForEvent("page", { timeout: 7000 }).catch(() => null);
      await visualButton.click({ timeout: 10000 }).catch(() => undefined);
      const viewerPage = (await viewPopupPromise) || certPage;
      if (viewerPage !== certPage) {
        await viewerPage.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
      }
      const pageText = await viewerPage.locator("body").innerText().catch(() => "");
      const dates = extractDatesFromText(pageText);
      const issueDate = toIsoDate(dates[0] ?? null);
      const expiryDate = toIsoDate(dates[dates.length - 1] ?? null);
      if (expiryDate) {
        return {
          ok: true,
          issueDate,
          expiryDate,
          sourceUrl: viewerPage.url(),
          rawText: pageText.slice(0, 10000),
        };
      }
    }

    const pageText = await certPage.locator("body").innerText().catch(() => "");
    const lower = pageText.toLowerCase();
    const dates = extractDatesFromText(pageText);
    const issueDate = toIsoDate(dates[0] ?? null);
    const expiryDate = toIsoDate(dates[dates.length - 1] ?? null);
    if (!expiryDate) {
      const looksLikeInitialPage =
        containsAny(lower, ["critérios de pesquisa", "criterios de pesquisa", "consulta regularidade do empregador"]);
      return {
        ok: false,
        errorMessage: looksLikeInitialPage
          ? "Não foi possível concluir a consulta automática do CRF no portal."
          : "Não foi possível identificar a validade do CRF automaticamente.",
        rawText: pageText.slice(0, 6000),
        sourceUrl: page.url(),
      };
    }

    return {
      ok: true,
      issueDate,
      expiryDate,
      sourceUrl: page.url(),
      rawText: pageText.slice(0, 10000),
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: mapPlaywrightError(error),
    };
  } finally {
    try {
      if (context) await context.close();
    } catch {
      // noop
    }
    try {
      if (browser) await browser.close();
    } catch {
      // noop
    }
  }
}

export class BackendRunner implements CertidoesRunner {
  async execute(input: CertidoesRunnerInput): Promise<CertidaoProviderPayload> {
    const mockEnabled = process.env.CERTIDOES_MOCK_MODE === "true";
    const hasInfosimplesToken = (process.env.CERTIDOES_INFOSIMPLES_TOKEN || "").trim().length > 0;
    if (mockEnabled) {
      const today = new Date();
      const expiry = new Date(today.getTime());
      expiry.setDate(expiry.getDate() + 30);
      return {
        ok: true,
        issueDate: today.toISOString().slice(0, 10),
        expiryDate: expiry.toISOString().slice(0, 10),
        controlCode: `MOCK-${input.certType}-${Date.now()}`,
        pdfBase64: Buffer.from(`Certidão ${input.certType} - CNPJ ${input.cnpj}`).toString("base64"),
        rawText: `Data de emissão: ${today.toLocaleDateString("pt-BR")}\nValidade: ${expiry.toLocaleDateString("pt-BR")}`,
      };
    }

    try {
      if (input.certType === "CRF") {
        if (hasInfosimplesToken) {
          const providerPreferred = await fetchFromInfoSimples(input);
          if (providerPreferred.ok) return providerPreferred;
        }
        const crfByPlaywright = await fetchCrfWithPlaywright(input.cnpj);
        if (crfByPlaywright.ok) return crfByPlaywright;
        if (hasInfosimplesToken) {
          const providerFallback = await fetchFromInfoSimples(input);
          if (providerFallback.ok) return providerFallback;
        }
        return crfByPlaywright;
      }
      return await fetchFromInfoSimples(input);
    } catch (error) {
      return {
        ok: false,
        errorMessage: `Falha na execução online das certidões: ${error instanceof Error ? error.message : "erro desconhecido"}`,
      };
    }
  }
}
