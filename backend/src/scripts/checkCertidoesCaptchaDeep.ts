import { chromium, Page } from "playwright";

type Result = {
  cert: "CNDT" | "CNF" | "CRF";
  url: string;
  status: number | null;
  finalUrl: string | null;
  title: string | null;
  captchaSignals: string[];
  antiBotSignals: string[];
  actions: string[];
  notes: string[];
};

const CAPTCHA_PATTERNS = [
  "captcha",
  "recaptcha",
  "hcaptcha",
  "g-recaptcha",
  "cf-turnstile",
  "não sou um robô",
  "nao sou um robo",
];

const ANTIBOT_PATTERNS = [
  "access denied",
  "acesso negado",
  "forbidden",
  "request blocked",
  "verify you are human",
  "bot detected",
];

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

async function detectSignals(page: Page): Promise<{ captchaSignals: string[]; antiBotSignals: string[] }> {
  const { html, text } = await page.evaluate(() => ({
    html: (document.documentElement?.outerHTML || "").toLowerCase(),
    text: (document.body?.innerText || "").toLowerCase(),
  }));
  const merged = `${html}\n${text}`;
  return {
    captchaSignals: uniq(CAPTCHA_PATTERNS.filter((p) => merged.includes(p))),
    antiBotSignals: uniq(ANTIBOT_PATTERNS.filter((p) => merged.includes(p))),
  };
}

async function runCndt(page: Page): Promise<Result> {
  const result: Result = {
    cert: "CNDT",
    url: "https://cndt-certidao.tst.jus.br/inicio.faces",
    status: null,
    finalUrl: null,
    title: null,
    captchaSignals: [],
    antiBotSignals: [],
    actions: [],
    notes: [],
  };
  try {
    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    result.status = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = await page.title();

    const hasCpfCnpjInput = await page.locator("input[id*='cpf'], input[id*='cnpj'], input[name*='cpf'], input[name*='cnpj']").count();
    result.actions.push(`inputs-cpf-cnpj-detectados=${hasCpfCnpjInput}`);
    const signals = await detectSignals(page);
    result.captchaSignals = signals.captchaSignals;
    result.antiBotSignals = signals.antiBotSignals;
    if (!signals.captchaSignals.length) {
      result.notes.push("Sem sinal de captcha explícito no carregamento inicial.");
    }
  } catch (error) {
    result.notes.push(`Falha ao abrir CNDT: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  }
  return result;
}

async function runCrf(page: Page): Promise<Result> {
  const result: Result = {
    cert: "CRF",
    url: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf",
    status: null,
    finalUrl: null,
    title: null,
    captchaSignals: [],
    antiBotSignals: [],
    actions: [],
    notes: [],
  };
  try {
    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    result.status = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = await page.title();

    const inputCount = await page.locator("input").count();
    result.actions.push(`inputs-detectados=${inputCount}`);

    // Tenta preencher algum campo com hint de CNPJ/CEI/inscrição e clicar em consultar.
    const didFill = await page.evaluate((digits: string) => {
      const inputs = Array.from(document.querySelectorAll("input"));
      const target = inputs.find((input) => {
        const key = `${input.id || ""} ${input.getAttribute("name") || ""} ${input.getAttribute("placeholder") || ""}`.toLowerCase();
        return key.includes("cnpj") || key.includes("cei") || key.includes("inscri");
      });
      if (!target) return { filled: false, clicked: false, reason: "input-nao-encontrado" };
      target.focus();
      target.value = "";
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.value = digits;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));

      const submit = Array.from(document.querySelectorAll("button,input[type='submit'],a")).find((el) => {
        const text = (el.textContent || (el as HTMLInputElement).value || "").toLowerCase();
        return text.includes("consultar") || text.includes("pesquisar") || text.includes("emitir");
      });
      if (!submit) return { filled: true, clicked: false, reason: "botao-nao-encontrado" };
      (submit as HTMLElement).click();
      return { filled: true, clicked: true, buttonText: (submit.textContent || (submit as HTMLInputElement).value || "").trim() };
    }, "00000000000191");
    result.actions.push(`fill-click=${JSON.stringify(didFill)}`);

    await page.waitForTimeout(4500);
    result.finalUrl = page.url();
    const signals = await detectSignals(page);
    result.captchaSignals = signals.captchaSignals;
    result.antiBotSignals = signals.antiBotSignals;
    if (!signals.captchaSignals.length && !signals.antiBotSignals.length) {
      result.notes.push("Sem sinal textual explícito de captcha/antibot até o passo de consulta.");
    }
  } catch (error) {
    result.notes.push(`Falha ao abrir/testar CRF: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  }
  return result;
}

async function runCnf(page: Page): Promise<Result> {
  const baseUrl = "https://solucoes.receita.fazenda.gov.br/Servicos/certidao/";
  const result: Result = {
    cert: "CNF",
    url: baseUrl,
    status: null,
    finalUrl: null,
    title: null,
    captchaSignals: [],
    antiBotSignals: [],
    actions: [],
    notes: [],
  };
  try {
    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    result.status = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = await page.title();

    const matchedLink = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const candidate = anchors.find((a) => {
        const href = (a.getAttribute("href") || "").toLowerCase();
        const txt = (a.textContent || "").toLowerCase();
        return href.includes("certinter/pj") || txt.includes("emissão da certidão") || txt.includes("emissao da certidao");
      });
      return candidate?.getAttribute("href") || null;
    });
    result.actions.push(`link-emissao-encontrado=${matchedLink ?? "nao"}`);

    if (matchedLink) {
      await page.goto(new URL(matchedLink, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1500);
      result.finalUrl = page.url();
      result.title = await page.title();
      result.actions.push("navegou-para-link-emissao=true");
    } else {
      result.actions.push("navegou-para-link-emissao=false");
    }

    const signals = await detectSignals(page);
    result.captchaSignals = signals.captchaSignals;
    result.antiBotSignals = signals.antiBotSignals;
    if ((await page.content()).includes("404")) {
      result.notes.push("Página de emissão PJ retornou 404 no momento do teste.");
    }
  } catch (error) {
    result.notes.push(`Falha ao abrir/testar CNF: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  }
  return result;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "pt-BR",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const results: Result[] = [];
  results.push(await runCndt(page));
  results.push(await runCrf(page));
  results.push(await runCnf(page));

  await context.close();
  await browser.close();

  console.log("=== Diagnóstico profundo CAPTCHA/antibot ===");
  for (const r of results) {
    const level = r.antiBotSignals.length > 0 ? "ANTIBOT" : r.captchaSignals.length > 0 ? "CAPTCHA" : "SEM SINAL EXPLÍCITO";
    console.log(`[${r.cert}] ${level} | status=${r.status ?? "n/a"} | finalUrl=${r.finalUrl ?? "n/a"} | title=${r.title ?? "n/a"}`);
    if (r.captchaSignals.length) console.log(`  captcha=${r.captchaSignals.join(",")}`);
    if (r.antiBotSignals.length) console.log(`  antibot=${r.antiBotSignals.join(",")}`);
    for (const a of r.actions) console.log(`  action=${a}`);
    for (const n of r.notes) console.log(`  note=${n}`);
  }
  console.log("=== JSON ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
