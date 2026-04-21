import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createExpenseTemplate,
  createFinanceEntry,
  deleteFinanceEntry,
  generateExpenseMonth,
  getPayablesOverview,
  listFinanceEntries,
  payFinanceEntry,
  updateFinanceEntry,
} from "../services/financeApi";
import { FinanceEntry, FinanceEntryType, FinanceTotals } from "../types";

const DEFAULT_CATEGORIES = [
  "Aluguel",
  "Energia",
  "Água",
  "Internet",
  "Folha",
  "Impostos",
  "Serviços",
  "Transporte",
  "Fornecedores",
  "Outros",
];

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 5a3 3 0 0 1 3-3h9a1 1 0 1 1 0 2H7a1 1 0 0 0 0 2h11a2 2 0 0 1 2 2v2h-2V8H7a3 3 0 1 1 0-6h10a1 1 0 1 1 0 2H7a1 1 0 0 0-1 1Zm14 6h2v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a1 1 0 1 1 2 0v7a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5Zm-2 2a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="m3 17.25 9.81-9.81 2.75 2.75L5.75 20H3v-2.75Zm14.71-8.79-2.75-2.75 1.39-1.39a1 1 0 0 1 1.41 0l1.34 1.34a1 1 0 0 1 0 1.41l-1.39 1.39Z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 3a1 1 0 0 0-1 1v1H5a1 1 0 1 0 0 2h.7l.8 12.06A2 2 0 0 0 8.5 21h7a2 2 0 0 0 1.99-1.94L18.3 7H19a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9Zm1 2V5h4V5h-4Zm-1.3 2h6.6l-.77 11.5a.5.5 0 0 1-.5.5h-4.06a.5.5 0 0 1-.5-.5L8.7 7Zm2.3 2a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0v-6a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0v-6a1 1 0 0 0-1-1Z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M9.55 17.2 4.7 12.35l1.4-1.4 3.45 3.45 8.35-8.35 1.4 1.4-9.75 9.75Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="m18.3 5.71-1.41-1.42L12 9.17 7.11 4.29 5.7 5.71 10.58 10.6 5.7 15.49l1.41 1.42L12 12.03l4.89 4.88 1.41-1.42-4.88-4.89 4.88-4.89Z"
      />
    </svg>
  );
}

function monthNow(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatBrlNumber(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatBrlInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const cents = Number(digits) / 100;
  return cents.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseBrlInput(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function buildDueDateCurrentMonth(day: number): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const endDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(1, day), endDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function buildDueDateWithSameMonth(baseIsoDate: string, day: number): string {
  const [yearRaw, monthRaw] = baseIsoDate.split("-").map(Number);
  const fallback = todayIso();
  const [fallbackYear, fallbackMonth] = fallback.split("-").map(Number);
  const year = Number.isFinite(yearRaw) ? yearRaw : fallbackYear;
  const month = Number.isFinite(monthRaw) ? monthRaw : fallbackMonth;
  const endDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(1, day), endDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function extractInstallmentInfo(description: string): { description: string; installmentLabel: string } {
  const trimmed = description.trim();
  const match = trimmed.match(/^(.*)\s\((\d+)\/(\d+)\)$/);
  if (!match) {
    return { description: trimmed, installmentLabel: "-" };
  }
  const baseDescription = (match[1] ?? "").trim() || trimmed;
  const installmentLabel = `${match[2]}/${match[3]}`;
  return { description: baseDescription, installmentLabel };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId = 0;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

const initialTotals: FinanceTotals = { receitas: 0, despesas: 0, saldo: 0 };

export function FinanceiroPage() {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [totals, setTotals] = useState<FinanceTotals>(initialTotals);
  const [monthRef, setMonthRef] = useState(monthNow());
  const [typeFilter, setTypeFilter] = useState<"todos" | FinanceEntryType>("todos");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [launchingMonth, setLaunchingMonth] = useState(false);
  const [overview, setOverview] = useState<{
    dueToday: Array<{ id: number; description: string; amount: number }>;
    overdue: Array<{ id: number; description: string; amount: number }>;
  }>({ dueToday: [], overdue: [] });

  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [deleteChoiceEntry, setDeleteChoiceEntry] = useState<FinanceEntry | null>(null);
  const [entryModalError, setEntryModalError] = useState("");
  const [entryForm, setEntryForm] = useState({
    type: "receita" as FinanceEntryType,
    description: "",
    category: DEFAULT_CATEGORIES[0],
    amount: "",
    dueDate: todayIso(),
    notes: "",
    recurring: false,
    recurringDueDay: "10",
    recurringVariable: false,
    installmentEnabled: false,
    installmentsCount: "2",
    installmentFrequency: "mensal" as "mensal" | "trimestral" | "anual",
  });

  const categoryOptions = useMemo(() => {
    const dynamic = entries.map((entry) => entry.category?.trim()).filter((value): value is string => Boolean(value));
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...dynamic])).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [entries]);

  const orderedEntries = useMemo(
    () => [...entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id - a.id),
    [entries],
  );

  const installmentPreviewLabel = useMemo(() => {
    if (entryForm.type !== "despesa" || !entryForm.installmentEnabled) return "";
    const installmentsCount = Number(entryForm.installmentsCount);
    const amount = parseBrlInput(entryForm.amount);
    if (!Number.isInteger(installmentsCount) || installmentsCount < 2) return "";
    if (!Number.isFinite(amount) || amount <= 0) return "";
    const installmentValue = amount / installmentsCount;
    return `${installmentsCount}x de ${formatBrlNumber(installmentValue)}`;
  }, [entryForm.amount, entryForm.installmentEnabled, entryForm.installmentsCount, entryForm.type]);

  const feedbackLabel = (text: string): string => {
    const normalized = text.toLowerCase();
    if (normalized.includes("falha") || normalized.includes("erro")) return "Erro";
    if (normalized.includes("sucesso") || normalized.includes("salv") || normalized.includes("exclu") || normalized.includes("marcada")) {
      return "Sucesso";
    }
    return "Aviso";
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [entryData, payableData] = await Promise.all([
        listFinanceEntries({ monthRef, type: typeFilter === "todos" ? undefined : typeFilter }),
        getPayablesOverview(),
      ]);
      setEntries(entryData.items);
      setTotals(entryData.totals);
      setOverview({
        dueToday: payableData.dueToday.map((item) => ({ id: item.id, description: item.description, amount: item.amount })),
        overdue: payableData.overdue.map((item) => ({ id: item.id, description: item.description, amount: item.amount })),
      });
    } catch {
      setMessage("Falha ao carregar financeiro.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [monthRef, typeFilter]);

  const resetEntryForm = (type: FinanceEntryType) => {
    setEditingEntryId(null);
    setEntryForm({
      type,
      description: "",
      category: DEFAULT_CATEGORIES[0],
      amount: "",
      dueDate: todayIso(),
      notes: "",
      recurring: false,
      recurringDueDay: "10",
      recurringVariable: false,
      installmentEnabled: false,
      installmentsCount: "2",
      installmentFrequency: "mensal",
    });
  };

  const openNewEntryModal = (type: FinanceEntryType) => {
    resetEntryForm(type);
    setEntryModalError("");
    setIsEntryModalOpen(true);
  };

  const openEditEntryModal = (entry: FinanceEntry) => {
    setEditingEntryId(entry.id);
    setEntryForm({
      type: entry.type,
      description: entry.description,
      category: entry.category || DEFAULT_CATEGORIES[0],
      amount: formatBrlInput(String(Math.round(entry.amount * 100))),
      dueDate: entry.dueDate ?? todayIso(),
      notes: entry.notes ?? "",
      recurring: false,
      recurringDueDay: entry.dueDate ? String(new Date(`${entry.dueDate}T00:00:00`).getDate()) : "10",
      recurringVariable: false,
      installmentEnabled: false,
      installmentsCount: "2",
      installmentFrequency: "mensal",
    });
    setEntryModalError("");
    setIsEntryModalOpen(true);
  };

  const onAddCategory = () => {
    const custom = window.prompt("Informe a nova categoria:")?.trim();
    if (!custom) return;
    setEntryForm((prev) => ({ ...prev, category: custom }));
  };

  const onSubmitEntry = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseBrlInput(entryForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Valor inválido.");
      return;
    }
    if (entryForm.type === "despesa" && entryForm.installmentEnabled) {
      const installmentsCount = Number(entryForm.installmentsCount);
      if (!Number.isInteger(installmentsCount) || installmentsCount < 2) {
        setMessage("Informe uma quantidade de parcelas válida (mínimo 2).");
        return;
      }
    }

    setSaving(true);
    setEntryModalError("");
    try {
      const payload = {
        type: entryForm.type,
        description: entryForm.description.trim(),
        category: entryForm.category.trim(),
        amount,
        entryDate: todayIso(),
        dueDate: entryForm.type === "despesa" ? entryForm.dueDate : undefined,
        referenceMonth: entryForm.type === "despesa" ? monthNow() : undefined,
        notes: entryForm.notes.trim(),
        installmentsCount:
          entryForm.type === "despesa" && entryForm.installmentEnabled
            ? Math.max(2, Number(entryForm.installmentsCount || "2"))
            : undefined,
        installmentFrequency:
          entryForm.type === "despesa" && entryForm.installmentEnabled ? entryForm.installmentFrequency : undefined,
      };

      if (editingEntryId) {
        await withTimeout(
          updateFinanceEntry(editingEntryId, payload),
          20000,
          "O salvamento demorou mais que o esperado. Tente novamente.",
        );
      } else {
        const created = (await withTimeout(
          createFinanceEntry(payload),
          20000,
          "O salvamento demorou mais que o esperado. Tente novamente.",
        )) as FinanceEntry & { createdCount?: number };
        const createdCount = Number(created.createdCount ?? 1);
        if (createdCount > 1) {
          setMessage(`${createdCount} parcelas lançadas com sucesso.`);
        }
        if (entryForm.type === "despesa" && entryForm.recurring && !entryForm.installmentEnabled) {
          const recurringDay = Number(entryForm.recurringDueDay);
          try {
            await createExpenseTemplate({
              description: entryForm.description.trim(),
              category: entryForm.category.trim(),
              defaultAmount: amount,
              dueDay: Number.isFinite(recurringDay) ? recurringDay : 10,
              startMonth: entryForm.dueDate.slice(0, 7),
              isVariable: entryForm.recurringVariable,
              active: true,
              notes: entryForm.notes.trim(),
            });
          } catch {
            setMessage("Lançamento salvo, mas não foi possível salvar o recorrente agora.");
          }
        }
      }

      setIsEntryModalOpen(false);
      resetEntryForm(entryForm.type);
      setMessage((current) => (current ? current : "Lançamento salvo com sucesso."));
      await loadData();
    } catch {
      setEntryModalError("Falha ao salvar lançamento. Tente novamente.");
      setMessage("Falha ao salvar lançamento.");
    } finally {
      setSaving(false);
    }
  };

  const deleteEntryWithScope = async (entry: FinanceEntry, scope: "single" | "from_current") => {
    try {
      const response = await deleteFinanceEntry(entry.id, { scope });
      const deletedCount = Number(response.deletedCount ?? 0);
      if (deletedCount > 1) {
        setMessage(`${deletedCount} lançamentos excluídos (este e posteriores).`);
      } else {
        setMessage("Lançamento excluído.");
      }
      await loadData();
    } catch {
      setMessage("Falha ao excluir lançamento.");
    }
  };

  const onDeleteEntry = async (entry: FinanceEntry) => {
    const hasInstallments =
      Boolean(entry.installmentGroupKey && (entry.installmentTotal ?? 0) > 1 && (entry.installmentIndex ?? 0) > 0) ||
      /\(\d+\/\d+\)\s*$/.test(entry.description);

    if (hasInstallments) {
      setDeleteChoiceEntry(entry);
      return;
    }

    const ok = window.confirm(`Excluir lançamento "${entry.description}"?`);
    if (!ok) return;
    await deleteEntryWithScope(entry, "single");
  };

  const onMarkPaid = async (entry: FinanceEntry) => {
    try {
      await payFinanceEntry(entry.id);
      setMessage("Conta marcada como paga.");
      await loadData();
    } catch {
      setMessage("Falha ao marcar conta como paga.");
    }
  };

  const onLaunchMonth = async () => {
    setLaunchingMonth(true);
    try {
      const response = await generateExpenseMonth(monthRef);
      setMessage(`Mês lançado. ${response.generatedCount} despesas planejadas.`);
      await loadData();
    } catch {
      setMessage("Falha ao lançar despesas do mês.");
    } finally {
      setLaunchingMonth(false);
    }
  };

  return (
    <div className="financeiro-page">
      <section className="card">
        <div className="section-header-row">
          <h2 className="loan-title-icon-label">
            <WalletIcon />
            <span>Financeiro</span>
          </h2>
          <div className="row">
            <button type="button" className="primary-button" onClick={() => openNewEntryModal("receita")}>
              + Receita
            </button>
            <button type="button" className="primary-button" onClick={() => openNewEntryModal("despesa")}>
              + Despesa
            </button>
            <input type="month" value={monthRef} onChange={(event) => setMonthRef(event.target.value)} />
            <button type="button" onClick={() => void onLaunchMonth()} disabled={launchingMonth}>
              {launchingMonth ? "Lançando..." : "Despesas do mês"}
            </button>
          </div>
        </div>

        <div className="financeiro-grid">
          <article className="financeiro-card financeiro-card-receitas">
            <h3>Receitas</h3>
            <strong>{formatCurrency(totals.receitas)}</strong>
          </article>
          <article className="financeiro-card financeiro-card-despesas">
            <h3>Despesas</h3>
            <strong>{formatCurrency(totals.despesas)}</strong>
          </article>
          <article className={`financeiro-card ${totals.saldo >= 0 ? "financeiro-card-saldo-pos" : "financeiro-card-saldo-neg"}`}>
            <h3>Saldo</h3>
            <strong>{formatCurrency(totals.saldo)}</strong>
          </article>
          <article className="financeiro-card">
            <h3>Contas do dia</h3>
            <strong>{overview.dueToday.length}</strong>
          </article>
          <article className="financeiro-card">
            <h3>Em atraso</h3>
            <strong>{overview.overdue.length}</strong>
          </article>
        </div>
      </section>

      <section className="card">
        <div className="section-header-row">
          <h3>Lançamentos</h3>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "todos" | FinanceEntryType)}>
            <option value="todos">Todos</option>
            <option value="receita">Receitas</option>
            <option value="despesa">Despesas</option>
          </select>
        </div>

        <div className="financeiro-payables-grid">
          <article className="financeiro-payables-card">
            <h4>Do dia</h4>
            {overview.dueToday.length === 0 ? (
              <p>Nenhuma conta para hoje.</p>
            ) : (
              overview.dueToday.map((item) => (
                <div key={`today-${item.id}`} className="financeiro-payable-item">
                  <span>{item.description}</span>
                  <strong>{formatCurrency(item.amount)}</strong>
                </div>
              ))
            )}
          </article>
          <article className="financeiro-payables-card">
            <h4>Em atraso</h4>
            {overview.overdue.length === 0 ? (
              <p>Sem atrasos no momento.</p>
            ) : (
              overview.overdue.map((item) => (
                <div key={`over-${item.id}`} className="financeiro-payable-item">
                  <span>{item.description}</span>
                  <strong>{formatCurrency(item.amount)}</strong>
                </div>
              ))
            )}
          </article>
        </div>

        <div className="transaction-table-wrap">
          <table className="transaction-data-table">
            <thead>
              <tr>
                <th>Lançamento</th>
                <th>Vencimento</th>
                <th>Status</th>
                <th>Tipo</th>
                <th>Parcela</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Valor</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9}>Carregando lançamentos...</td>
                </tr>
              ) : orderedEntries.length === 0 ? (
                <tr>
                  <td colSpan={9}>Nenhum lançamento encontrado.</td>
                </tr>
              ) : (
                orderedEntries.map((entry) => (
                  <tr key={entry.id}>
                    {(() => {
                      const installmentInfo = extractInstallmentInfo(entry.description);
                      return (
                        <>
                    <td>{new Date(`${entry.entryDate}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                    <td>{entry.dueDate ? new Date(`${entry.dueDate}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                    <td>{entry.status === "pago" ? "Pago" : entry.status === "atrasado" ? "Atrasado" : "Pendente"}</td>
                    <td>{entry.type === "receita" ? "Receita" : "Despesa"}</td>
                    <td>{installmentInfo.installmentLabel}</td>
                    <td>{installmentInfo.description}</td>
                    <td>{entry.category || "-"}</td>
                    <td>{formatCurrency(entry.amount)}</td>
                    <td>
                      <div className="row">
                        {entry.type === "despesa" ? (
                          entry.status !== "pago" ? (
                            <button
                              type="button"
                              className="transaction-icon-button success"
                              title="Marcar como paga"
                              aria-label="Marcar como paga"
                              onClick={() => void onMarkPaid(entry)}
                            >
                              <CheckIcon />
                            </button>
                          ) : (
                            <span className="transaction-status-chip success financeiro-paid-chip" title="Conta paga" aria-label="Conta paga">
                              Pago
                            </span>
                          )
                        ) : (
                          <span className="transaction-status-icon placeholder" aria-hidden="true" />
                        )}
                        <button
                          type="button"
                          className="transaction-icon-button"
                          title="Editar lançamento"
                          aria-label="Editar lançamento"
                          onClick={() => openEditEntryModal(entry)}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="transaction-icon-button danger"
                          title="Excluir lançamento"
                          aria-label="Excluir lançamento"
                          onClick={() => void onDeleteEntry(entry)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                        </>
                      );
                    })()}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isEntryModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>{editingEntryId ? "Editar lançamento" : entryForm.type === "receita" ? "Nova receita" : "Nova despesa"}</h2>
              <button
                type="button"
                className="transaction-icon-button"
                onClick={() => setIsEntryModalOpen(false)}
                disabled={saving}
                title="Fechar"
                aria-label="Fechar modal"
              >
                <CloseIcon />
              </button>
            </div>
            <form className="form-stack" onSubmit={onSubmitEntry}>
              {entryModalError ? <p className="financeiro-modal-error">{entryModalError}</p> : null}
              <label>
                Descrição
                <input
                  value={entryForm.description}
                  onChange={(event) => setEntryForm((prev) => ({ ...prev, description: event.target.value }))}
                  required
                />
              </label>

              <label>
                Categoria
                <div className="financeiro-category-row">
                  <select
                    value={entryForm.category}
                    onChange={(event) => setEntryForm((prev) => ({ ...prev, category: event.target.value }))}
                  >
                    {categoryOptions.map((category) => (
                      <option key={`category-${category}`} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="financeiro-add-category-button" onClick={onAddCategory} title="Adicionar categoria">
                    +
                  </button>
                </div>
              </label>

              <label>
                Valor (R$)
                <input
                  type="text"
                  inputMode="decimal"
                  value={entryForm.amount}
                  onChange={(event) =>
                    setEntryForm((prev) => ({ ...prev, amount: formatBrlInput(event.target.value) }))
                  }
                  placeholder="0,00"
                  required
                />
              </label>

              {entryForm.type === "despesa" ? (
                <label>
                  Vencimento desta conta
                  <input
                    type="date"
                    value={entryForm.dueDate}
                    onChange={(event) => setEntryForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                    required
                  />
                </label>
              ) : null}

              {entryForm.type === "despesa" && !editingEntryId ? (
                <>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={entryForm.installmentEnabled}
                      onChange={(event) =>
                        setEntryForm((prev) => ({
                          ...prev,
                          installmentEnabled: event.target.checked,
                          installmentsCount: prev.installmentsCount || "2",
                          installmentFrequency: prev.installmentFrequency || "mensal",
                          recurring: event.target.checked ? false : prev.recurring,
                        }))
                      }
                    />
                    Despesa parcelada
                  </label>

                  {entryForm.installmentEnabled ? (
                    <div className="financeiro-form-grid">
                      <label>
                        Quantidade de parcelas
                        <input
                          type="number"
                          min={2}
                          max={120}
                          value={entryForm.installmentsCount}
                          onChange={(event) =>
                            setEntryForm((prev) => ({
                              ...prev,
                              installmentsCount: event.target.value,
                            }))
                          }
                          required
                        />
                      </label>
                      <label>
                        Periodicidade
                        <select
                          value={entryForm.installmentFrequency}
                          onChange={(event) =>
                            setEntryForm((prev) => ({
                              ...prev,
                              installmentFrequency: event.target.value as "mensal" | "trimestral" | "anual",
                            }))
                          }
                        >
                          <option value="mensal">Mensal</option>
                          <option value="trimestral">Trimestral</option>
                          <option value="anual">Anual</option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                  {installmentPreviewLabel ? (
                    <small className="muted-text">{`Parcelamento: ${installmentPreviewLabel}`}</small>
                  ) : null}

                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={entryForm.recurring}
                      disabled={entryForm.installmentEnabled}
                      onChange={(event) =>
                        setEntryForm((prev) => {
                          if (!event.target.checked) {
                            return { ...prev, recurring: false };
                          }
                          const pickedDay = Number(prev.dueDate?.slice(8, 10) || prev.recurringDueDay || "10");
                          const safeDay = Number.isFinite(pickedDay) && pickedDay > 0 ? pickedDay : 10;
                          return {
                            ...prev,
                            recurring: true,
                            recurringDueDay: String(safeDay),
                            dueDate: buildDueDateWithSameMonth(prev.dueDate || todayIso(), safeDay),
                          };
                        })
                      }
                    />
                    Despesa recorrente mensal
                  </label>

                  {entryForm.recurring ? (
                    <div className="financeiro-form-grid">
                      <label>
                        Dia vencimento mensal
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={entryForm.recurringDueDay}
                          onChange={(event) => {
                            const nextDay = event.target.value;
                            setEntryForm((prev) => ({
                              ...prev,
                              recurringDueDay: nextDay,
                              dueDate: buildDueDateWithSameMonth(prev.dueDate || todayIso(), Number(nextDay || "10")),
                            }));
                          }}
                          required
                        />
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={entryForm.recurringVariable}
                          onChange={(event) => setEntryForm((prev) => ({ ...prev, recurringVariable: event.target.checked }))}
                        />
                        Valor variável
                      </label>
                    </div>
                  ) : null}
                </>
              ) : null}

              <label>
                Observações
                <textarea
                  rows={3}
                  value={entryForm.notes}
                  onChange={(event) => setEntryForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </label>

              <small className="muted-text">{`Data de lançamento: hoje (${new Date(todayIso()).toLocaleDateString("pt-BR")}).`}</small>

              <div className="modal-actions">
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar"}
                </button>
                <button type="button" className="financeiro-modal-cancel-button" onClick={() => setIsEntryModalOpen(false)} disabled={saving}>
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {deleteChoiceEntry ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Excluir parcela</h2>
              <button type="button" className="transaction-icon-button" onClick={() => setDeleteChoiceEntry(null)} title="Fechar">
                <CloseIcon />
              </button>
            </div>
            <p className="muted-text">Este lançamento faz parte de um parcelamento. Como deseja excluir?</p>
            <div className="modal-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const selectedEntry = deleteChoiceEntry;
                  setDeleteChoiceEntry(null);
                  if (selectedEntry) void deleteEntryWithScope(selectedEntry, "single");
                }}
              >
                Somente este
              </button>
              <button
                type="button"
                className="financeiro-modal-danger-button"
                onClick={() => {
                  const selectedEntry = deleteChoiceEntry;
                  setDeleteChoiceEntry(null);
                  if (selectedEntry) void deleteEntryWithScope(selectedEntry, "from_current");
                }}
              >
                Este e posteriores
              </button>
              <button type="button" onClick={() => setDeleteChoiceEntry(null)}>
                Cancelar
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {message ? <p className="copy-feedback">{`${feedbackLabel(message)}: ${message}`}</p> : null}
    </div>
  );
}
