import { CertidoesRunner, CertidoesRunnerInput } from "./certidoes.runner";
import { CertidaoProviderPayload } from "../certidoes.types";

export class AgentRunner implements CertidoesRunner {
  private readonly baseUrl: string;

  private readonly token: string;

  constructor() {
    this.baseUrl = (process.env.VPN_AGENT_URL || "http://127.0.0.1:48321").replace(/\/+$/, "");
    this.token = (process.env.AGENT_API_TOKEN || "").trim();
  }

  private cleanMessage(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed) as { errorMessage?: unknown; message?: unknown };
      if (typeof parsed.errorMessage === "string" && parsed.errorMessage.trim()) {
        return parsed.errorMessage.trim();
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      // Não é JSON, segue limpeza textual.
    }
    const withoutTags = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return withoutTags || trimmed;
  }

  async execute(input: CertidoesRunnerInput): Promise<CertidaoProviderPayload> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/certidoes/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { "x-agent-token": this.token } : {}),
        },
        body: JSON.stringify({
          certType: input.certType,
          cnpj: input.cnpj,
          certificateName: input.certificate.certificateName,
          certificateContentBase64: input.certificate.certificateContentBase64,
          certificatePassword: input.certificate.certificatePassword,
          certificateExpiresAt: input.certificate.certificateExpiresAt,
        }),
      });
      if (!response.ok) {
        if (response.status === 404) {
          return {
            ok: false,
            errorMessage: "Agente local desatualizado para certidões. Atualize/reinicie o agente VPN deste computador.",
          };
        }
        const text = await response.text();
        const clean = this.cleanMessage(text);
        return { ok: false, errorMessage: clean || "Agente local falhou ao atualizar certidão." };
      }
      return (await response.json()) as CertidaoProviderPayload;
    } catch {
      return {
        ok: false,
        errorMessage: "Agente local indisponível para executar a atualização desta certidão.",
      };
    }
  }
}
