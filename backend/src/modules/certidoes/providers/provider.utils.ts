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
