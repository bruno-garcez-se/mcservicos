import { Browser, BrowserContext, Page, chromium } from "playwright";
import path from "path";

type SeconsigTarget = {
  servidorId: number;
  nome?: string;
  matricula: string;
};

export type SeconsigSyncItem = {
  servidorId: number;
  nomePesquisado: string;
  nomeEncontrado?: string;
  cpf?: string;
  margemAtual?: number;
  status?: string;
  payload?: unknown;
  found: boolean;
  exactMatch: boolean;
  error?: string;
};

export type SeconsigSyncResult = {
  items: SeconsigSyncItem[];
  stats: {
    processados: number;
    encontrados: number;
    naoEncontrados: number;
    falhas: number;
  };
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCurrency(value: string): number | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractByLabel(text: string, labelRegex: RegExp): string {
  const match = text.match(labelRegex);
  return (match?.[1] ?? "").trim();
}

async function readInputValueBySelectors(page: Page, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const inputValue = await locator.inputValue().catch(() => "");
    if (String(inputValue).trim()) return String(inputValue).trim();
    const attrValue = await locator.getAttribute("value").catch(() => null);
    if (typeof attrValue === "string" && attrValue.trim()) return attrValue.trim();
    const text = await locator.textContent().catch(() => null);
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return "";
}

function buildUrlCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl.trim();
  if (!trimmed) return [];
  let primary = trimmed;
  if (!/^https?:\/\//i.test(primary)) primary = `https://${primary}`;

  const candidates = new Set<string>([primary]);
  try {
    const parsed = new URL(primary);
    if (parsed.hostname.startsWith("www.")) {
      const withoutWww = new URL(primary);
      withoutWww.hostname = parsed.hostname.replace(/^www\./i, "");
      candidates.add(withoutWww.toString());
    } else {
      const withWww = new URL(primary);
      withWww.hostname = `www.${parsed.hostname}`;
      candidates.add(withWww.toString());
    }
  } catch {
    // Ignora fallback de URL inválida.
  }
  return [...candidates];
}

function isDnsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("err_name_not_resolved") || lower.includes("name not resolved") || lower.includes("net::err");
}

async function gotoSeconsig(page: Page, baseUrl: string): Promise<void> {
  const candidates = buildUrlCandidates(baseUrl);
  if (candidates.length === 0) {
    throw new Error("URL do SECONSIG inválida para navegação.");
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 45000 });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  const details = lastError instanceof Error ? lastError.message : String(lastError ?? "");
  if (isDnsError(lastError)) {
    throw new Error(
      `Falha de DNS ao abrir o SECONSIG (${candidates.join(" | ")}). Verifique se a VPN/rede desta máquina resolve o domínio.`,
    );
  }
  throw new Error(`Falha ao abrir o SECONSIG: ${details}`);
}

async function fillInputByCandidates(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count();
    if (!count) continue;
    await locator.fill("");
    await locator.fill(value);
    return true;
  }
  return false;
}

async function setGrupoConsignante(page: Page, grupoConsignante: string): Promise<void> {
  // Seletor exato informado pelo usuário no SECONSIG.
  const explicitSelect = page.locator("#grupo-consignante-filtro").first();
  if ((await explicitSelect.count()) > 0) {
    try {
      await explicitSelect.selectOption({ label: grupoConsignante });
      return;
    } catch {
      // fallback para value conhecido do grupo principal.
      try {
        await explicitSelect.selectOption("3");
        return;
      } catch {
        // segue para fallback genérico
      }
    }
  }

  const selectCandidates = [
    "select[name*='grupo']",
    "select[id*='grupo']",
    "select[name*='consignante']",
    "select[id*='consignante']",
  ];
  for (const selector of selectCandidates) {
    const select = page.locator(selector).first();
    if ((await select.count()) === 0) continue;
    try {
      await select.selectOption({ label: grupoConsignante });
      return;
    } catch {
      // tenta próximo.
    }
  }
}

async function clickFiltrar(page: Page): Promise<void> {
  // Seletor exato informado pelo usuário no SECONSIG.
  const explicitButton = page.locator("#btnFiltrarConsignadoVinculo").first();
  if ((await explicitButton.count()) > 0) {
    await explicitButton.click({ timeout: 12000 });
    return;
  }

  const button = page
    .locator("button, input[type='submit'], a")
    .filter({ hasText: /filtrar|pesquisar|consultar/i })
    .first();
  if ((await button.count()) > 0) {
    await button.click({ timeout: 12000 });
    return;
  }
  await page.keyboard.press("Enter");
}

function normalizeStatus(value: string): "Habilitada" | "Desabilitada" | "Indefinido" {
  const status = normalizeText(value);
  if (status.includes("desabil")) return "Desabilitada";
  if (status.includes("habilit")) return "Habilitada";
  return "Indefinido";
}

type SeconsigRowCandidate = {
  rowIndex: number;
  nome: string;
  cpf: string;
  status: string;
  isEnabled: boolean;
};

async function listRowsByMatricula(page: Page): Promise<SeconsigRowCandidate[]> {
  const rows = page.locator("table tbody tr");
  const totalRows = await rows.count();
  if (!totalRows) return [];
  const candidates: SeconsigRowCandidate[] = [];

  for (let index = 0; index < totalRows; index += 1) {
    const row = rows.nth(index);
    const cells = row.locator("td");
    const totalCells = await cells.count();
    if (totalCells < 2) continue;
    const nameText = await cells.nth(0).innerText().catch(() => "");
    const cpfText = await cells.nth(1).innerText().catch(() => "");
    const statusText = await row.locator("td.situacao").first().innerText().catch(async () => {
      if (totalCells >= 6) {
        return cells.nth(5).innerText().catch(() => "");
      }
      return "";
    });

    candidates.push({
      rowIndex: index,
      nome: nameText.trim(),
      cpf: cpfText.trim(),
      status: statusText.trim(),
      isEnabled: normalizeStatus(statusText) === "Habilitada",
    });
  }
  return candidates;
}

async function openRowByIndex(page: Page, rowIndex: number): Promise<void> {
  const row = page.locator("table tbody tr").nth(rowIndex);
  const explicitViewButton = row.locator("button:has(span.fa-eye), a:has(span.fa-eye)").first();
  const viewButton = (await explicitViewButton.count()) > 0 ? explicitViewButton : row.locator("a, button").last();
  if ((await viewButton.count()) === 0) {
    throw new Error("Botão de visualizar (olho) não encontrado para o vínculo habilitado.");
  }
  await viewButton.click({ timeout: 12000 });
}

async function clickAtualizarMargemIfExists(page: Page): Promise<void> {
  const button = page
    .locator("button, a, input[type='submit']")
    .filter({ hasText: /atualizar margem/i })
    .first();
  if ((await button.count()) === 0) return;
  await button.click({ timeout: 12000 });
  await page.waitForTimeout(2600);
}

async function clickVoltarIfExists(page: Page): Promise<void> {
  const button = page
    .locator("button, a, input[type='submit']")
    .filter({ hasText: /voltar/i })
    .first();
  if ((await button.count()) === 0) return;
  await button.click({ timeout: 12000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => undefined);
}

async function loginSeconsig(page: Page, baseUrl: string, username: string, password: string): Promise<void> {
  await gotoSeconsig(page, baseUrl);
  const userFilled = await fillInputByCandidates(page, ["input[name*='login']", "input[id*='login']", "input[type='text']"], username);
  const passFilled = await fillInputByCandidates(
    page,
    ["input[name*='senha']", "input[id*='senha']", "input[type='password']"],
    password,
  );
  if (!userFilled || !passFilled) {
    throw new Error("Não foi possível localizar campos de login/senha no SECONSIG.");
  }
  const loginButton = page
    .locator("button, input[type='submit'], a")
    .filter({ hasText: /entrar|acessar|login/i })
    .first();
  if ((await loginButton.count()) > 0) {
    await loginButton.click({ timeout: 12000 });
  } else {
    await page.keyboard.press("Enter");
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
}

export async function runSeconsigSyncTeste(params: {
  baseUrl: string;
  username: string;
  password: string;
  grupoConsignante: string;
  targets: SeconsigTarget[];
}): Promise<SeconsigSyncResult> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let usingCdp = false;
  const items: SeconsigSyncItem[] = [];
  try {
    const cdpUrl = (process.env.SECONSIG_CDP_URL || "http://127.0.0.1:9222").trim();
    if (cdpUrl) {
      try {
        browser = await chromium.connectOverCDP(cdpUrl, { timeout: 4000 });
        context = browser.contexts()[0] ?? null;
        usingCdp = Boolean(context);
      } catch {
        usingCdp = false;
      }
    }

    if (!context) {
      const userDataDir =
        process.env.SECONSIG_USER_DATA_DIR?.trim() ||
        path.resolve(process.cwd(), ".seconsig-browser-profile");
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        locale: "pt-BR",
      });
    }

    const existingSeconsigPage =
      context
        .pages()
        .find((candidate) => candidate.url().toLowerCase().includes("seconsig")) ?? null;

    const page = existingSeconsigPage ?? context.pages()[0] ?? (await context.newPage());
    if (!existingSeconsigPage) {
      await gotoSeconsig(page, params.baseUrl);
    } else {
      await page.bringToFront().catch(() => undefined);
    }
    const initialBodyText = await page.locator("body").innerText().catch(() => "");
    const initialLower = initialBodyText.toLowerCase();
    if (
      initialLower.includes("não é possível acessar esse site") ||
      initialLower.includes("nao e possivel acessar esse site") ||
      initialLower.includes("err_name_not_resolved") ||
      initialLower.includes("dns_probe_finished_nxdomain")
    ) {
      throw new Error(
        "A aba do SECONSIG anexada está em erro de DNS (ERR_NAME_NOT_RESOLVED). Conecte a VPN e recarregue a aba antes de importar.",
      );
    }

    const hasNomeFiltro = await page.locator("#nome-filtro").count().then((count) => count > 0);
    const hasGrupoFiltro = await page
      .locator("#grupo-consignante-filtro")
      .count()
      .then((count) => count > 0);
    const hasFiltrarButton = await page
      .locator("#btnFiltrarConsignadoVinculo")
      .count()
      .then((count) => count > 0);
    if (!hasNomeFiltro || !hasGrupoFiltro || !hasFiltrarButton) {
      throw new Error(
        "A aba anexada não está na tela de Consignado do SECONSIG. Abra essa tela e tente novamente.",
      );
    }

    const hasNomeInput = await page
      .locator("input[name*='nome'], input[id*='nome']")
      .first()
      .count()
      .then((count) => count > 0)
      .catch(() => false);
    if (!hasNomeInput) {
      if (!params.username.trim() || !params.password.trim()) {
        throw new Error(
          "Sessão do SECONSIG não está logada no perfil do robô e não há credenciais para login automático.",
        );
      }
      await loginSeconsig(page, params.baseUrl, params.username, params.password);
    }

    for (const target of params.targets.slice(0, 1000)) {
      const current: SeconsigSyncItem = {
        servidorId: target.servidorId,
        nomePesquisado: target.matricula,
        found: false,
        exactMatch: false,
      };
      try {
        await fillInputByCandidates(page, ["input[name*='cpf']", "input[id*='cpf']"], "");
        await fillInputByCandidates(page, ["#nome-filtro", "input[name='nome-filtro']", "input[name*='nome']", "input[id*='nome']"], "");
        const filledMatricula = await fillInputByCandidates(
          page,
          ["#cod-vinculo-filtro", "input[name='cod-vinculo-filtro']", "input[name*='matricula']", "input[id*='matricula']", "input[name*='vinculo']", "input[id*='vinculo']"],
          target.matricula,
        );
        if (!filledMatricula) {
          throw new Error("Campo de matrícula/vínculo da busca não foi localizado no SECONSIG.");
        }
        await setGrupoConsignante(page, params.grupoConsignante);
        await clickFiltrar(page);
        await page.waitForTimeout(1200);

        const rows = await listRowsByMatricula(page);
        if (rows.length === 0) {
          current.status = "Não encontrado";
          items.push(current);
          continue;
        }

        const enabledRows = rows.filter((row) => row.isEnabled);
        if (enabledRows.length === 0) {
          current.found = true;
          current.exactMatch = true;
          current.nomeEncontrado = rows[0]?.nome || target.nome;
          const firstCpf = rows.find((row) => row.cpf)?.cpf;
          if (firstCpf) {
            current.cpf = firstCpf;
          }
          const normalizedRowStatus = normalizeStatus(rows[0]?.status ?? "");
          current.status = normalizedRowStatus === "Desabilitada" ? "Desabilitada" : (rows[0]?.status || "Desabilitada");
          current.payload = {
            matriculaPesquisada: target.matricula,
            totalVinculosEncontrados: rows.length,
            totalVinculosHabilitados: 0,
          };
          items.push(current);
          continue;
        }

        let totalMargemAtual = 0;
        let encontrouMargem = false;
        let cpfConsolidado = "";
        let nomeConsolidado = "";
        const margensLidas: number[] = [];

        for (const row of enabledRows) {
          await openRowByIndex(page, row.rowIndex);
          await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => undefined);
          await clickAtualizarMargemIfExists(page);
          const detailText = await page.locator("body").innerText();
          const cpfInputValue = await readInputValueBySelectors(page, [
            "input[name='j_idt86']",
            "input[id*='cpf']",
            "input[name*='cpf']",
            "input.campo-leitura[name='j_idt86']",
          ]);
          const margemInputValue = await readInputValueBySelectors(page, [
            "#margem",
            "input[name='margem']",
            "input[id*='margem']",
            "input.money[name='margem']",
          ]);
          const cpf = cpfInputValue || row.cpf || extractByLabel(detailText, /CPF:\s*([0-9.\-\/]+)/i);
          const margemRaw = margemInputValue || extractByLabel(detailText, /Margem atual R\$\*:\s*([0-9.,-]+)/i);
          const margemAtual = parseCurrency(margemRaw);
          const nomeEncontrado = extractByLabel(detailText, /Nome:\s*([^\n\r]+)/i) || row.nome || target.nome;
          if (!cpfConsolidado && cpf) {
            cpfConsolidado = cpf;
          }
          if (!nomeConsolidado && nomeEncontrado) {
            nomeConsolidado = nomeEncontrado;
          }
          if (margemAtual !== undefined) {
            totalMargemAtual += margemAtual;
            encontrouMargem = true;
            margensLidas.push(margemAtual);
          }
          await clickVoltarIfExists(page);
          await setGrupoConsignante(page, params.grupoConsignante);
          await clickFiltrar(page);
          await page.waitForTimeout(900);
        }

        current.nomeEncontrado = nomeConsolidado || enabledRows[0]?.nome || target.nome;
        current.cpf = cpfConsolidado || enabledRows.find((row) => row.cpf)?.cpf || undefined;
        current.margemAtual = encontrouMargem ? Number(totalMargemAtual.toFixed(2)) : undefined;
        current.status = "Habilitado";
        current.payload = {
          matriculaPesquisada: target.matricula,
          totalVinculosEncontrados: rows.length,
          totalVinculosHabilitados: enabledRows.length,
          margensLidas,
        };
        current.found = true;
        current.exactMatch = true;
        items.push(current);
      } catch (error) {
        current.error = error instanceof Error ? error.message : "Falha na leitura do item.";
        items.push(current);
      }
    }

    const encontrados = items.filter((item) => item.found && item.exactMatch).length;
    const falhas = items.filter((item) => item.error).length;
    const naoEncontrados = items.length - encontrados;
    return {
      items,
      stats: {
        processados: items.length,
        encontrados,
        naoEncontrados,
        falhas,
      },
    };
  } finally {
    try {
      if (context && !usingCdp) await context.close();
    } catch {
      // noop
    }
    try {
      if (browser && usingCdp) await browser.close();
    } catch {
      // noop
    }
  }
}
