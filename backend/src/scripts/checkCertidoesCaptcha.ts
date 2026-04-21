import { chromium } from "playwright";

type PortalCheck = {
  key: "CNDT" | "CNF" | "CRF";
  url: string;
};

type PortalResult = {
  key: "CNDT" | "CNF" | "CRF";
  url: string;
  finalUrl: string | null;
  title: string | null;
  status: number | null;
  loaded: boolean;
  captchaSignals: string[];
  antiBotSignals: string[];
  notes: string[];
};

const PORTALS: PortalCheck[] = [
  { key: "CNDT", url: "https://cndt-certidao.tst.jus.br/inicio.faces" },
  { key: "CNF", url: "https://solucoes.receita.fazenda.gov.br/Servicos/certidaointernet/PJ/Emitir" },
  { key: "CRF", url: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf" },
];

const CAPTCHA_PATTERNS = [
  "captcha",
  "recaptcha",
  "hcaptcha",
  "g-recaptcha",
  "cf-turnstile",
  "sou humano",
  "não sou um robô",
  "nao sou um robo",
];

const ANTIBOT_PATTERNS = [
  "access denied",
  "acesso negado",
  "forbidden",
  "request blocked",
  "bot detected",
  "verify you are human",
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function checkPortal(portal: PortalCheck): Promise<PortalResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale: "pt-BR",
  });
  const page = await context.newPage();

  const result: PortalResult = {
    key: portal.key,
    url: portal.url,
    finalUrl: null,
    title: null,
    status: null,
    loaded: false,
    captchaSignals: [],
    antiBotSignals: [],
    notes: [],
  };

  try {
    const response = await page.goto(portal.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    result.status = response?.status() ?? null;
    result.loaded = true;
    await page.waitForTimeout(1500);
    result.finalUrl = page.url();
    result.title = await page.title();

    const html = (await page.content()).toLowerCase();
    const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    const merged = `${html}\n${text}`;

    result.captchaSignals = unique(CAPTCHA_PATTERNS.filter((p) => merged.includes(p)));
    result.antiBotSignals = unique(ANTIBOT_PATTERNS.filter((p) => merged.includes(p)));

    if (!result.captchaSignals.length && !result.antiBotSignals.length) {
      result.notes.push("Sem sinal textual explícito de CAPTCHA/antibot na página inicial.");
    }
    if ((result.status ?? 0) >= 400) {
      result.notes.push(`HTTP ${result.status} ao abrir página inicial.`);
    }
  } catch (error) {
    result.notes.push(
      `Falha ao navegar: ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
  } finally {
    await context.close();
    await browser.close();
  }

  return result;
}

function printSummary(results: PortalResult[]) {
  console.log("=== Diagnóstico CAPTCHA/Anti-bot (Playwright) ===");
  for (const item of results) {
    const blocked = item.antiBotSignals.length > 0 || (item.status ?? 0) === 403;
    const hasCaptcha = item.captchaSignals.length > 0;
    const outcome = blocked
      ? "BLOQUEIO/ANTIBOT DETECTADO"
      : hasCaptcha
        ? "CAPTCHA DETECTADO"
        : "SEM SINAL EXPLÍCITO";
    console.log(
      `[${item.key}] ${outcome} | status=${item.status ?? "n/a"} | finalUrl=${item.finalUrl ?? "n/a"}`,
    );
    if (item.captchaSignals.length > 0) {
      console.log(`  captchaSignals: ${item.captchaSignals.join(", ")}`);
    }
    if (item.antiBotSignals.length > 0) {
      console.log(`  antiBotSignals: ${item.antiBotSignals.join(", ")}`);
    }
    if (item.notes.length > 0) {
      for (const note of item.notes) console.log(`  note: ${note}`);
    }
  }
  console.log("=== JSON ===");
  console.log(JSON.stringify(results, null, 2));
}

async function main() {
  const results: PortalResult[] = [];
  for (const portal of PORTALS) {
    // Executa sequencialmente para evitar ruído de bloqueio por bursts.
    const checked = await checkPortal(portal);
    results.push(checked);
  }
  printSummary(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
