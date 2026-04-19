import { TransactionDay, TransactionMonthData, TransactionMonthSummary, TransactionTerminal } from "../types";
import { http } from "./http";

export async function getTransactionMonth(
  year: number,
  month: number,
  terminalId?: number,
): Promise<TransactionMonthData> {
  const { data } = await http.get<TransactionMonthData>("/transactions/month", {
    params: { year, month, terminalId },
  });
  return data;
}

export async function listTransactionMonths(limit = 24, terminalId?: number): Promise<TransactionMonthSummary[]> {
  const { data } = await http.get<{ items: TransactionMonthSummary[] }>("/transactions/months", {
    params: { limit, terminalId },
  });
  return data.items ?? [];
}

export async function listTransactionTerminals(): Promise<TransactionTerminal[]> {
  const { data } = await http.get<{ items: TransactionTerminal[] }>("/transactions/terminals");
  return data.items ?? [];
}

export async function createTransactionTerminal(payload: { code: string; name?: string }): Promise<TransactionTerminal> {
  const { data } = await http.post<TransactionTerminal>("/transactions/terminals", payload);
  return data;
}

export async function upsertTransactionDaily(payload: {
  terminalId: number;
  date: string;
  authCount: number;
  saqueCount: number;
  pixSaqueCount: number;
  recargaValue: number;
}): Promise<TransactionDay> {
  const { data } = await http.post<TransactionDay>("/transactions/daily", payload);
  return data;
}

export async function deleteTransactionDaily(id: number): Promise<void> {
  await http.delete(`/transactions/daily/${id}`);
}

export async function importTransactionDaily(payload: {
  terminalId: number;
  entries: Array<{
    date: string;
    authCount: number;
    saqueCount: number;
    pixSaqueCount: number;
    recargaValue: number;
  }>;
}): Promise<{ importedRows: number }> {
  const { data } = await http.post<{ importedRows: number }>("/transactions/import", payload);
  return data;
}
