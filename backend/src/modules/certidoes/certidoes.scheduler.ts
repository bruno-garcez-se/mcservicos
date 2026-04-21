import { autoRefreshExpiringCertidoes } from "./certidoes.service";

let intervalHandle: NodeJS.Timeout | null = null;

export function setupCertidoesScheduler(): void {
  if (intervalHandle) return;
  const intervalMs = Number(process.env.CERTIDOES_SCHEDULER_INTERVAL_MS || 1000 * 60 * 60 * 24);
  intervalHandle = setInterval(() => {
    void autoRefreshExpiringCertidoes().catch(() => {
      // Mantém scheduler resiliente mesmo quando uma execução falha.
    });
  }, intervalMs);
}
