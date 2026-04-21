import { CertidaoTipo, CertificateConfigRecord, CertidaoProviderPayload } from "../certidoes.types";

export type CertidoesRunnerInput = {
  certType: CertidaoTipo;
  cnpj: string;
  certificate: CertificateConfigRecord;
};

export interface CertidoesRunner {
  execute(input: CertidoesRunnerInput): Promise<CertidaoProviderPayload>;
}
