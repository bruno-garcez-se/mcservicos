import { CertidaoFetchResult, CertidaoProviderPayload } from "../certidoes.types";
import { CertidaoProvider } from "./certidao.provider";
import { extractDateByLabel, parsePtBrDate } from "./provider.utils";

export class CndtProvider implements CertidaoProvider {
  readonly certType = "CNDT" as const;
  readonly sourceUrl = "https://www.tst.jus.br/certidao";

  normalize(payload: CertidaoProviderPayload): CertidaoFetchResult {
    const issueDate =
      parsePtBrDate(payload.issueDate ?? null) ??
      extractDateByLabel(payload.rawText, ["Data de emissão", "Emitida em", "Data de Emissão"]);
    const expiryDate =
      parsePtBrDate(payload.expiryDate ?? null) ??
      extractDateByLabel(payload.rawText, ["Data de validade", "Válida até", "Validade"]);
    return {
      ok: Boolean(payload.ok),
      issueDate,
      expiryDate,
      controlCode: payload.controlCode?.trim() || null,
      pdfBase64: payload.pdfBase64?.trim() || null,
      sourceUrl: payload.sourceUrl?.trim() || this.sourceUrl,
      rawText: payload.rawText?.trim() || null,
      errorMessage: payload.errorMessage?.trim() || null,
    };
  }
}
