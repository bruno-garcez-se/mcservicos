import { CertidaoFetchResult, CertidaoProviderPayload } from "../certidoes.types";
import { CertidaoProvider } from "./certidao.provider";
import { extractControlCodeByLabel, extractDateByLabel, extractDatesInText, parsePtBrDate } from "./provider.utils";

export class CndjProvider implements CertidaoProvider {
  readonly certType = "CNDJ" as const;
  readonly sourceUrl = "https://www.tjse.jus.br/";

  normalize(payload: CertidaoProviderPayload): CertidaoFetchResult {
    const dates = extractDatesInText(payload.rawText);
    const issueDate =
      parsePtBrDate(payload.issueDate ?? null) ??
      extractDateByLabel(payload.rawText, ["Data da emissão", "Emitida em", "expedida"]) ??
      dates[0] ??
      null;
    const expiryDate =
      parsePtBrDate(payload.expiryDate ?? null) ??
      extractDateByLabel(payload.rawText, ["Válida até", "Validade"]) ??
      dates[dates.length - 1] ??
      null;
    return {
      ok: Boolean(payload.ok),
      issueDate,
      expiryDate,
      controlCode:
        payload.controlCode?.trim() ||
        extractControlCodeByLabel(payload.rawText, ["Código de Autenticidade", "Protocolo", "Autenticação"]) ||
        null,
      pdfBase64: payload.pdfBase64?.trim() || null,
      sourceUrl: payload.sourceUrl?.trim() || this.sourceUrl,
      rawText: payload.rawText?.trim() || null,
      errorMessage: payload.errorMessage?.trim() || null,
    };
  }
}
