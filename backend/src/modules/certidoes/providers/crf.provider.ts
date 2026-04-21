import { CertidaoFetchResult, CertidaoProviderPayload } from "../certidoes.types";
import { CertidaoProvider } from "./certidao.provider";
import { extractDateByLabel, extractDateRangeByLabel, parsePtBrDate } from "./provider.utils";

export class CrfProvider implements CertidaoProvider {
  readonly certType = "CRF" as const;
  readonly sourceUrl = "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf";

  normalize(payload: CertidaoProviderPayload): CertidaoFetchResult {
    const validityRange = extractDateRangeByLabel(payload.rawText, ["Validade"]);
    const issueDate =
      parsePtBrDate(payload.issueDate ?? null) ??
      extractDateByLabel(payload.rawText, ["Data de emissão", "Emitida em", "Data emissão"]) ??
      validityRange?.startDate ??
      null;
    const expiryDate =
      parsePtBrDate(payload.expiryDate ?? null) ??
      extractDateByLabel(payload.rawText, ["Data de validade", "Válida até"]) ??
      validityRange?.endDate ??
      null;
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
