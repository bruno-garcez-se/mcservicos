export function parsePtBrDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const direct = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const br = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

export function extractDateByLabel(rawText: string | null | undefined, labels: string[]): string | null {
  if (!rawText) return null;
  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*[:\\-]?\\s*(\\d{2}\\/\\d{2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2})`, "i");
    const match = rawText.match(regex);
    if (!match?.[1]) continue;
    const parsed = parsePtBrDate(match[1]);
    if (parsed) return parsed;
  }
  return null;
}

export function extractDateRangeByLabel(
  rawText: string | null | undefined,
  labels: string[],
): { startDate: string | null; endDate: string | null } | null {
  if (!rawText) return null;
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `${escaped}\\s*[:\\-]?\\s*(\\d{2}\\/\\d{2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2})\\s*(?:a|até|ate|-)\\s*(\\d{2}\\/\\d{2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2})`,
      "i",
    );
    const match = rawText.match(regex);
    if (!match?.[1] || !match?.[2]) continue;
    const startDate = parsePtBrDate(match[1]);
    const endDate = parsePtBrDate(match[2]);
    if (!startDate && !endDate) continue;
    return { startDate: startDate ?? null, endDate: endDate ?? null };
  }
  return null;
}

export function extractControlCodeByLabel(rawText: string | null | undefined, labels: string[]): string | null {
  if (!rawText) return null;
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}\\s*[:\\-]?\\s*([A-Za-z0-9./\\-_]+)`, "i");
    const match = rawText.match(regex);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  const fallback = rawText.match(
    /(c[oó]digo(?:\s+de)?\s+controle|n[uú]mero(?:\s+da)?\s+certid[aã]o)\s*[:\-]?\s*([A-Za-z0-9./\-_]+)/i,
  );
  return fallback?.[2]?.trim() || null;
}
