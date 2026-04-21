import { http } from "./http";
import { FinanceEntry, FinanceExpenseTemplate, FinanceTotals } from "../types";

type FinanceEntryPayload = {
  type: "receita" | "despesa";
  description: string;
  category?: string;
  amount: number;
  entryDate: string;
  dueDate?: string;
  referenceMonth?: string;
  paidAt?: string;
  paidAmount?: number;
  templateId?: number;
  notes?: string;
  installmentsCount?: number;
  installmentFrequency?: "mensal" | "trimestral" | "anual";
};

type ExpenseTemplatePayload = {
  description: string;
  category?: string;
  defaultAmount: number;
  dueDay: number;
  startMonth?: string;
  isVariable?: boolean;
  active?: boolean;
  notes?: string;
};

type FinanceListResponse = {
  items: FinanceEntry[];
  totals: FinanceTotals;
};

export async function listFinanceEntries(filters?: {
  monthRef?: string;
  type?: "receita" | "despesa";
}): Promise<FinanceListResponse> {
  const { data } = await http.get<FinanceListResponse>("/financial/entries", { params: filters });
  return data;
}

export async function createFinanceEntry(payload: FinanceEntryPayload): Promise<FinanceEntry> {
  const { data } = await http.post<FinanceEntry>("/financial/entries", payload);
  return data;
}

export async function updateFinanceEntry(id: number, payload: FinanceEntryPayload): Promise<FinanceEntry> {
  const { data } = await http.put<FinanceEntry>(`/financial/entries/${id}`, payload);
  return data;
}

export async function deleteFinanceEntry(
  id: number,
  options?: { scope?: "single" | "from_current" },
): Promise<{ deletedCount: number }> {
  const { data } = await http.delete<{ deletedCount: number }>(`/financial/entries/${id}`, {
    data: options?.scope ? { scope: options.scope } : undefined,
  });
  return data;
}

export async function payFinanceEntry(id: number, payload?: { paidAt?: string; paidAmount?: number }): Promise<void> {
  await http.patch(`/financial/entries/${id}/pay`, payload ?? {});
}

export async function listExpenseTemplates(): Promise<FinanceExpenseTemplate[]> {
  const { data } = await http.get<FinanceExpenseTemplate[]>("/financial/expense-templates");
  return data;
}

export async function createExpenseTemplate(payload: ExpenseTemplatePayload): Promise<FinanceExpenseTemplate> {
  const { data } = await http.post<FinanceExpenseTemplate>("/financial/expense-templates", payload);
  return data;
}

export async function updateExpenseTemplate(id: number, payload: ExpenseTemplatePayload): Promise<FinanceExpenseTemplate> {
  const { data } = await http.put<FinanceExpenseTemplate>(`/financial/expense-templates/${id}`, payload);
  return data;
}

export async function deleteExpenseTemplate(id: number): Promise<void> {
  await http.delete(`/financial/expense-templates/${id}`);
}

export async function generateExpenseMonth(monthRef: string): Promise<{ generatedCount: number }> {
  const { data } = await http.post<{ generatedCount: number }>("/financial/expense-templates/generate-month", { monthRef });
  return data;
}

export async function getPayablesOverview(date?: string): Promise<{
  date: string;
  dueToday: Array<{ id: number; description: string; amount: number; dueDate: string }>;
  overdue: Array<{ id: number; description: string; amount: number; dueDate: string }>;
}> {
  const { data } = await http.get("/financial/payables/overview", { params: date ? { date } : undefined });
  return data;
}
