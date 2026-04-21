import { CertidaoFetchResult, CertidaoProviderPayload, CertidaoTipo } from "../certidoes.types";

export interface CertidaoProvider {
  readonly certType: CertidaoTipo;
  readonly sourceUrl: string;
  normalize(payload: CertidaoProviderPayload): CertidaoFetchResult;
}
