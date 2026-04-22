import { CertidaoFetchResult, CertidaoProviderPayload } from "../certidoes.types";
import { CertidaoProvider } from "./certidao.provider";
import { extractControlCodeByLabel, extractDateByLabel, extractDatesInText, parsePtBrDate } from "./provider.utils";

export class CndmProvider implements CertidaoProvider {
  readonly certType = "CNDM" as const;
  readonly sourceUrl =
    "https://gestor.tributosmunicipais.com.br/redesim/prefeitura/socorro/views/publico/portaldocontribuinte/publico/autenticacao/autenticacao.xhtml";

  normalize(payload: CertidaoProviderPayload): CertidaoFetchResult {
    const dates = extractDatesInText(payload.rawText);
    const issueDate =
      parsePtBrDate(payload.issueDate ?? null) ??
      extractDateByLabel(payload.rawText, ["Data", "Data de emissão", "Emissão"]) ??
      dates[0] ??
      null;
    const expiryDate =
      parsePtBrDate(payload.expiryDate ?? null) ??
      extractDateByLabel(payload.rawText, ["Validade", "Válida até"]) ??
      dates[dates.length - 1] ??
      null;
    return {
      ok: Boolean(payload.ok),
      issueDate,
      expiryDate,
      controlCode:
        payload.controlCode?.trim() ||
        extractControlCodeByLabel(payload.rawText, ["Autenticação", "Codigo de autenticacao", "Sequencial"]) ||
        null,
      pdfBase64: payload.pdfBase64?.trim() || null,
      sourceUrl: payload.sourceUrl?.trim() || this.sourceUrl,
      rawText: payload.rawText?.trim() || null,
      errorMessage: payload.errorMessage?.trim() || null,
    };
  }
}
