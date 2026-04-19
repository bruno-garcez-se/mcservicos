async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar ${url} (${response.status})`);
  }
  return response.text();
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

async function main(): Promise<void> {
  const pageUrl = "https://www.transparencia.se.gov.br/RecursosHumanos/FolhaPagamento";
  const html = await fetchText(pageUrl);
  const scripts = uniq(
    Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g)).map((match) => match[1]),
  ).map((src) => (src.startsWith("http") ? src : `https://www.transparencia.se.gov.br${src}`));

  // eslint-disable-next-line no-console
  console.log(`Scripts encontrados: ${scripts.length}`);

  const interestingPatterns = [
    /\/RecursosHumanos\/FolhaPagamento\/[A-Za-z]+/g,
    /\/api\/[A-Za-z0-9/_-]*FolhaPagamento[A-Za-z0-9/_-]*/g,
    /https?:\/\/[^"'`\s)]*FolhaPagamento[^"'`\s)]*/g,
    /https?:\/\/[^"'`\s)]*RecursosHumanos[^"'`\s)]*/g,
    /[A-Za-z0-9/_-]*Consultar[A-Za-z0-9/_-]*/g,
    /[A-Za-z0-9/_-]*Detalhar[A-Za-z0-9/_-]*/g,
  ];

  const findings: string[] = [];

  for (const scriptUrl of scripts) {
    try {
      const body = await fetchText(scriptUrl);
      const localFindings: string[] = [];
      for (const regex of interestingPatterns) {
        const matches = Array.from(body.matchAll(regex)).map((m) => m[0]);
        localFindings.push(...matches);
      }
      const uniqueLocal = uniq(
        localFindings
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .filter((value) => /FolhaPagamento|RecursosHumanos|Consultar|Detalhar/i.test(value)),
      );
      if (uniqueLocal.length > 0) {
        findings.push(...uniqueLocal.map((value) => `${scriptUrl} :: ${value}`));
      }
    } catch {
      // ignore
    }
  }

  const uniqueFindings = uniq(findings);
  // eslint-disable-next-line no-console
  console.log("=== FINDINGS ===");
  for (const row of uniqueFindings.slice(0, 300)) {
    // eslint-disable-next-line no-console
    console.log(row);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
