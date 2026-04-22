import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createExpenseTemplate,
  createFinanceEntry,
  deleteFinanceEntry,
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function formatQuantityBase(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
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

function formatMonthRef(monthRef: string): string {
  const [yearRaw, monthRaw] = monthRef.split("-").map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return monthRef;
  const date = new Date(yearRaw, monthRaw - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function parseBrlInput(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parsePtNumber(value: string): number {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildDueDateCurrentMonth(day: number): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const endDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(1, day), endDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function buildIsoDateFromMonthRef(monthRef: string, day: number): string {
  const [yearRaw, monthRaw] = monthRef.split("-").map(Number);
  const fallback = todayIso();
  const [fallbackYear, fallbackMonth] = fallback.split("-").map(Number);
  const year = Number.isFinite(yearRaw) ? yearRaw : fallbackYear;
  const month = Number.isFinite(monthRaw) ? monthRaw : fallbackMonth;
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
const QUICK_REVENUE_CATEGORY = "Receitas mensais";
const QUICK_REVENUE_NOTES = "Gerado por Receitas rápidas";
type QuickRevenueDay = 5 | 20;
type QuickRevenueExtraField = { id: string; label: string; amount: string };

function createZeroQuickRevenueInputs() {
  return {
    pixSaque: "0",
    creditoConsignado: "0",
    recarga: "0",
    pagamento: "0",
    recebimento: "0",
    banesecard: "0",
    reajusteTransacional: "0",
    consignadoSeguro: "0",
    lotese: "0",
    tvIndoor: "0",
    outros: "0",
  };
}

export function FinanceiroPage() {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [totals, setTotals] = useState<FinanceTotals>(initialTotals);
  const [monthRef, setMonthRef] = useState(monthNow());
  const [typeFilter, setTypeFilter] = useState<"todos" | FinanceEntryType>("todos");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [overview, setOverview] = useState<{
    dueToday: Array<{ id: number; description: string; amount: number; dueDate: string }>;
    overdue: Array<{ id: number; description: string; amount: number; dueDate: string }>;
  }>({ dueToday: [], overdue: [] });
  const monthPickerRef = useRef<HTMLInputElement | null>(null);
  const revenueMenuRef = useRef<HTMLDivElement | null>(null);
  const expenseMenuRef = useRef<HTMLDivElement | null>(null);

  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [newExpenseMode, setNewExpenseMode] = useState<"avulsa" | "recorrente" | "parcelada" | null>(null);
  const [isQuickRevenueModalOpen, setIsQuickRevenueModalOpen] = useState(false);
  const [isRevenueMenuOpen, setIsRevenueMenuOpen] = useState(false);
  const [isExpenseMenuOpen, setIsExpenseMenuOpen] = useState(false);
  const [quickRevenueSaving, setQuickRevenueSaving] = useState(false);
  const [quickRevenueDay, setQuickRevenueDay] = useState<QuickRevenueDay>(5);
  const [quickRevenueInputs, setQuickRevenueInputs] = useState(createZeroQuickRevenueInputs);
  const [quickRevenueExtraFields, setQuickRevenueExtraFields] = useState<Record<QuickRevenueDay, QuickRevenueExtraField[]>>({
    5: [],
    20: [],
  });
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [deleteChoiceEntry, setDeleteChoiceEntry] = useState<FinanceEntry | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<number[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);
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
  const dueTodayTotal = useMemo(
    () => overview.dueToday.reduce((sum, item) => sum + item.amount, 0),
    [overview.dueToday],
  );
  const overdueMonthTotal = useMemo(
    () =>
      overview.overdue
        .filter((item) => item.dueDate.slice(0, 7) === monthRef)
        .reduce((sum, item) => sum + item.amount, 0),
    [monthRef, overview.overdue],
  );
  const quickRevenueRows = useMemo(() => {
    const pixSaqueQty = parsePtNumber(quickRevenueInputs.pixSaque);
    const creditoConsignadoQty = parsePtNumber(quickRevenueInputs.creditoConsignado);
    const recargaQty = parsePtNumber(quickRevenueInputs.recarga);
    const pagamentoQty = parsePtNumber(quickRevenueInputs.pagamento);
    const recebimentoQty = parsePtNumber(quickRevenueInputs.recebimento);
    const banesecard = parsePtNumber(quickRevenueInputs.banesecard);
    const reajusteTransacional = parsePtNumber(quickRevenueInputs.reajusteTransacional);
    const consignadoSeguro = parsePtNumber(quickRevenueInputs.consignadoSeguro);
    const lotese = parsePtNumber(quickRevenueInputs.lotese);
    const tvIndoor = parsePtNumber(quickRevenueInputs.tvIndoor);
    const outros = parsePtNumber(quickRevenueInputs.outros);

    const recebimentoValor =
      recebimentoQty < 2000
        ? recebimentoQty * 0.66
        : recebimentoQty < 5000
          ? recebimentoQty * 0.77
          : recebimentoQty < 10000
            ? recebimentoQty * 0.9
            : recebimentoQty < 25000
              ? recebimentoQty * 0.96
              : 1950;
    const baseProducao = pagamentoQty + recebimentoQty;
    const producaoPorPonto =
      baseProducao < 2000
        ? 0
        : baseProducao < 5000
          ? 300
          : baseProducao < 10000
            ? 750
            : baseProducao < 15000
              ? 1050
              : baseProducao < 20000
                ? 1350
                : baseProducao < 25000
                  ? 1650
                  : 1950;

    const customRowsDay05 = quickRevenueExtraFields[5]
      .map((field) => ({
        description: field.label.trim(),
        day: 5 as const,
        amount: roundMoney(parsePtNumber(field.amount)),
        quantity: 1,
        isCustom: true,
      }))
      .filter((field) => field.description.length > 0);
    const customRowsDay20 = quickRevenueExtraFields[20]
      .map((field) => ({
        description: field.label.trim(),
        day: 20 as const,
        amount: roundMoney(parsePtNumber(field.amount)),
        quantity: 1,
        isCustom: true,
      }))
      .filter((field) => field.description.length > 0);

    return [
      { description: "PIX Saque", day: 5, amount: roundMoney(pixSaqueQty * 0.8), quantity: pixSaqueQty },
      { description: "Crédito Consignado", day: 5, amount: roundMoney(creditoConsignadoQty * 0.03), quantity: creditoConsignadoQty },
      { description: "Recarga", day: 5, amount: roundMoney(recargaQty * 0.015), quantity: recargaQty },
      { description: "Pagamento", day: 5, amount: roundMoney(pagamentoQty * 0.8), quantity: pagamentoQty },
      { description: "Recebimento", day: 5, amount: roundMoney(recebimentoValor), quantity: recebimentoQty },
      { description: "Produção por Ponto", day: 5, amount: roundMoney(producaoPorPonto), quantity: baseProducao },
      ...customRowsDay05,
      { description: "BaneseCard", day: 20, amount: roundMoney(banesecard), quantity: 1 },
      { description: "Reajuste Transacional", day: 20, amount: roundMoney(reajusteTransacional), quantity: 1 },
      { description: "Consignado SE / Seguro", day: 20, amount: roundMoney(consignadoSeguro), quantity: 1 },
      { description: "Lotese", day: 20, amount: roundMoney(lotese), quantity: 1 },
      { description: "TV Indoor", day: 20, amount: roundMoney(tvIndoor), quantity: 1 },
      { description: "Outros", day: 20, amount: roundMoney(outros), quantity: 1 },
      ...customRowsDay20,
    ];
  }, [quickRevenueExtraFields, quickRevenueInputs]);
  const quickRevenueRowsByDay = useMemo(
    () => quickRevenueRows.filter((row) => row.day === quickRevenueDay),
    [quickRevenueDay, quickRevenueRows],
  );
  const quickRevenueProducaoPorPontoQtdBase = useMemo(() => {
    const row = quickRevenueRows.find((item) => item.description === "PRODUÇÃO POR PONTO");
    return row?.quantity ?? 0;
  }, [quickRevenueRows]);
  const quickRevenuePreviewTotalByDay = useMemo(
    () => quickRevenueRowsByDay.reduce((sum, row) => sum + row.amount, 0),
    [quickRevenueRowsByDay],
  );
  const receivedTotal = useMemo(
    () => entries.filter((entry) => entry.type === "receita" && entry.status === "pago").reduce((sum, entry) => sum + entry.amount, 0),
    [entries],
  );
  const awaitingPaymentTotal = useMemo(
    () => entries.filter((entry) => entry.type === "receita" && entry.status === "pendente").reduce((sum, entry) => sum + entry.amount, 0),
    [entries],
  );
  const paidExpensesTotal = useMemo(
    () => entries.filter((entry) => entry.type === "despesa" && entry.status === "pago").reduce((sum, entry) => sum + entry.amount, 0),
    [entries],
  );
  const payablePendingTotal = useMemo(
    () => entries.filter((entry) => entry.type === "despesa" && entry.status === "pendente").reduce((sum, entry) => sum + entry.amount, 0),
    [entries],
  );
  const remainingMonthTotal = useMemo(() => Math.max(0, payablePendingTotal - dueTodayTotal), [payablePendingTotal, dueTodayTotal]);

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
        dueToday: payableData.dueToday.map((item) => ({
          id: item.id,
          description: item.description,
          amount: item.amount,
          dueDate: item.dueDate,
        })),
        overdue: payableData.overdue.map((item) => ({
          id: item.id,
          description: item.description,
          amount: item.amount,
          dueDate: item.dueDate,
        })),
      });
      setSelectedEntryIds([]);
    } catch (error: unknown) {
      const apiMessage =
        typeof error === "object" &&
        error &&
        "response" in error &&
        typeof (error as { response?: unknown }).response === "object" &&
        (error as { response?: { data?: { message?: string } } }).response?.data?.message
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setMessage(apiMessage ?? "Falha ao carregar financeiro.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [monthRef, typeFilter]);
  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (isRevenueMenuOpen && !revenueMenuRef.current?.contains(target)) {
        setIsRevenueMenuOpen(false);
      }
      if (isExpenseMenuOpen && !expenseMenuRef.current?.contains(target)) {
        setIsExpenseMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [isExpenseMenuOpen, isRevenueMenuOpen]);

  const resetEntryForm = (type: FinanceEntryType) => {
    setEditingEntryId(null);
    setNewExpenseMode(type === "despesa" ? "avulsa" : null);
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

  const openMonthPicker = () => {
    const monthInput = monthPickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!monthInput) return;
    if (typeof monthInput.showPicker === "function") {
      monthInput.showPicker();
      return;
    }
    monthInput.focus();
    monthInput.click();
  };

  const openNewEntryModal = (type: FinanceEntryType) => {
    resetEntryForm(type);
    setEntryModalError("");
    setIsEntryModalOpen(true);
  };
  const openExpensePresetModal = (mode: "avulsa" | "recorrente" | "parcelada") => {
    resetEntryForm("despesa");
    setNewExpenseMode(mode);
    setEntryForm((prev) => {
      if (mode === "recorrente") {
        const pickedDay = Number(prev.dueDate?.slice(8, 10) || "10");
        const safeDay = Number.isFinite(pickedDay) && pickedDay > 0 ? pickedDay : 10;
        return {
          ...prev,
          recurring: true,
          recurringDueDay: String(safeDay),
          dueDate: buildDueDateWithSameMonth(prev.dueDate || todayIso(), safeDay),
          installmentEnabled: false,
        };
      }
      if (mode === "parcelada") {
        return {
          ...prev,
          installmentEnabled: true,
          installmentsCount: "2",
          installmentFrequency: "mensal",
          recurring: false,
        };
      }
      return {
        ...prev,
        recurring: false,
        installmentEnabled: false,
      };
    });
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
        let templateId: number | undefined;
        if (entryForm.type === "despesa" && entryForm.recurring && !entryForm.installmentEnabled) {
          const recurringDay = Number(entryForm.dueDate.slice(8, 10));
          const template = await createExpenseTemplate({
            description: entryForm.description.trim(),
            category: entryForm.category.trim(),
            defaultAmount: entryForm.recurringVariable ? 0.01 : amount,
            dueDay: Number.isFinite(recurringDay) ? recurringDay : 10,
            startMonth: entryForm.dueDate.slice(0, 7),
            isVariable: entryForm.recurringVariable,
            active: true,
            notes: entryForm.notes.trim(),
          });
          templateId = template.id;
        }
        const created = (await withTimeout(
          createFinanceEntry({ ...payload, templateId }),
          20000,
          "O salvamento demorou mais que o esperado. Tente novamente.",
        )) as FinanceEntry & { createdCount?: number };
        const createdCount = Number(created.createdCount ?? 1);
        if (createdCount > 1) {
          setMessage(`${createdCount} parcelas lançadas com sucesso.`);
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
    const hasRecurringTemplate = entry.type === "despesa" && Boolean(entry.templateId);

    if (hasInstallments || hasRecurringTemplate) {
      setDeleteChoiceEntry(entry);
      return;
    }

    const ok = window.confirm(`Excluir lançamento "${entry.description}"?`);
    if (!ok) return;
    await deleteEntryWithScope(entry, "single");
  };
  const toggleSelectEntry = (entryId: number) => {
    setSelectedEntryIds((prev) => (prev.includes(entryId) ? prev.filter((id) => id !== entryId) : [...prev, entryId]));
  };
  const toggleSelectAllVisibleEntries = () => {
    const visibleIds = orderedEntries.map((entry) => entry.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedEntryIds.includes(id));
    if (allSelected) {
      setSelectedEntryIds([]);
      return;
    }
    setSelectedEntryIds(visibleIds);
  };
  const selectedEntries = useMemo(
    () => orderedEntries.filter((entry) => selectedEntryIds.includes(entry.id)),
    [orderedEntries, selectedEntryIds],
  );
  const allVisibleSelected = orderedEntries.length > 0 && orderedEntries.every((entry) => selectedEntryIds.includes(entry.id));
  const onBulkMarkPaid = async () => {
    if (selectedEntries.length === 0) return;
    const pendingEntries = selectedEntries.filter((entry) => entry.status !== "pago");
    if (pendingEntries.length === 0) {
      setMessage("Todos os selecionados já estão quitados.");
      return;
    }
    setBulkProcessing(true);
    try {
      const results = await Promise.allSettled(pendingEntries.map((entry) => payFinanceEntry(entry.id)));
      const successIds = pendingEntries
        .map((entry, index) => (results[index]?.status === "fulfilled" ? entry.id : null))
        .filter((id): id is number => typeof id === "number");
      const successCount = successIds.length;
      const nowIso = todayIso();

      if (successCount > 0) {
        setEntries((current) =>
          current.map((entry) =>
            successIds.includes(entry.id)
              ? {
                  ...entry,
                  status: "pago",
                  paidAt: entry.paidAt ?? nowIso,
                  paidAmount: entry.paidAmount ?? entry.amount,
                }
              : entry,
          ),
        );
      }
      if (successCount === pendingEntries.length) {
        setMessage(`${successCount} lançamentos atualizados com sucesso.`);
      } else if (successCount > 0) {
        setMessage(`${successCount} de ${pendingEntries.length} lançamentos atualizados.`);
      } else {
        setMessage("Falha ao atualizar lançamentos selecionados.");
      }
      setSelectedEntryIds([]);
      try {
        await loadData();
      } catch {
        // mantém atualização local caso o recarregamento falhe
      }
    } finally {
      setBulkProcessing(false);
    }
  };
  const onBulkDelete = async () => {
    if (selectedEntries.length === 0) return;
    const ok = window.confirm(`Excluir ${selectedEntries.length} lançamentos selecionados? (somente estes)`);
    if (!ok) return;
    setBulkProcessing(true);
    try {
      const results = await Promise.allSettled(
        selectedEntries.map((entry) => deleteFinanceEntry(entry.id, { scope: "single" })),
      );
      const deletedIds = selectedEntries
        .map((entry, index) => (results[index]?.status === "fulfilled" ? entry.id : null))
        .filter((id): id is number => typeof id === "number");
      const deletedCount = deletedIds.length;

      if (deletedCount > 0) {
        setEntries((current) => current.filter((entry) => !deletedIds.includes(entry.id)));
      }
      if (deletedCount === selectedEntries.length) {
        setMessage(`${deletedCount} lançamentos excluídos.`);
      } else if (deletedCount > 0) {
        setMessage(`${deletedCount} de ${selectedEntries.length} lançamentos excluídos.`);
      } else {
        setMessage("Falha ao excluir lançamentos selecionados.");
      }
      setSelectedEntryIds([]);
      try {
        await loadData();
      } catch {
        // mantém atualização local caso o recarregamento falhe
      }
    } finally {
      setBulkProcessing(false);
    }
  };
  const deleteChoiceIsInstallment = Boolean(
    deleteChoiceEntry &&
      (Boolean(deleteChoiceEntry.installmentGroupKey && (deleteChoiceEntry.installmentTotal ?? 0) > 1) ||
        /\(\d+\/\d+\)\s*$/.test(deleteChoiceEntry.description)),
  );

  const onMarkPaid = async (entry: FinanceEntry) => {
    try {
      await payFinanceEntry(entry.id);
      setMessage(entry.type === "receita" ? "Receita marcada como recebida." : "Conta marcada como paga.");
      await loadData();
    } catch {
      setMessage(entry.type === "receita" ? "Falha ao marcar receita como recebida." : "Falha ao marcar conta como paga.");
    }
  };
  const openQuickRevenueModal = () => {
    setQuickRevenueDay(5);
    setQuickRevenueInputs(createZeroQuickRevenueInputs());
    setQuickRevenueExtraFields({ 5: [], 20: [] });
    setIsQuickRevenueModalOpen(true);
    setIsRevenueMenuOpen(false);
    setIsExpenseMenuOpen(false);
  };
  const onAddQuickRevenueExtraField = (day: QuickRevenueDay) => {
    setQuickRevenueExtraFields((prev) => ({
      ...prev,
      [day]: [...prev[day], { id: `${Date.now()}-${Math.random()}`, label: "", amount: "0" }],
    }));
  };
  const onUpdateQuickRevenueExtraField = (day: QuickRevenueDay, fieldId: string, patch: Partial<QuickRevenueExtraField>) => {
    setQuickRevenueExtraFields((prev) => ({
      ...prev,
      [day]: prev[day].map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
    }));
  };
  const onRemoveQuickRevenueExtraField = (day: QuickRevenueDay, fieldId: string) => {
    setQuickRevenueExtraFields((prev) => ({
      ...prev,
      [day]: prev[day].filter((field) => field.id !== fieldId),
    }));
  };
  const onApplyQuickRevenues = async () => {
    const rowsToApply = quickRevenueRowsByDay.filter((row) => row.amount > 0);
    if (rowsToApply.length === 0) {
      setMessage("Informe ao menos um valor de receita maior que zero.");
      return;
    }
    setQuickRevenueSaving(true);
    try {
      const existingRevenueEntries = await listFinanceEntries({ monthRef, type: "receita" });
      const existingMap = new Map<string, FinanceEntry>();
      for (const item of existingRevenueEntries.items) {
        const key = `${item.entryDate}|${item.description.trim().toLowerCase()}`;
        existingMap.set(key, item);
      }
      let createdCount = 0;
      let updatedCount = 0;
      for (const row of rowsToApply) {
        const entryDate = buildIsoDateFromMonthRef(monthRef, row.day);
        const key = `${entryDate}|${row.description.trim().toLowerCase()}`;
        const payload = {
          type: "receita" as const,
          description: row.description,
          category: QUICK_REVENUE_CATEGORY,
          amount: row.amount,
          entryDate,
          paidAt: entryDate,
          paidAmount: row.amount,
          notes: QUICK_REVENUE_NOTES,
        };
        const existing = existingMap.get(key);
        if (existing) {
          await updateFinanceEntry(existing.id, payload);
          updatedCount += 1;
        } else {
          await createFinanceEntry(payload);
          createdCount += 1;
        }
      }
      setMessage(`Receitas do dia ${String(quickRevenueDay).padStart(2, "0")} aplicadas: ${createdCount} criadas e ${updatedCount} atualizadas.`);
      setIsQuickRevenueModalOpen(false);
      await loadData();
    } catch {
      setMessage("Falha ao aplicar receitas rápidas.");
    } finally {
      setQuickRevenueSaving(false);
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
            <div className="financeiro-action-dropdown" ref={revenueMenuRef}>
              <button
                type="button"
                className="primary-button financeiro-action-button financeiro-action-button-receita"
                onClick={() => {
                  setIsExpenseMenuOpen(false);
                  setIsRevenueMenuOpen((current) => !current);
                }}
                aria-haspopup="menu"
                aria-expanded={isRevenueMenuOpen}
              >
                <span className="button-icon-inline">
                  <PlusIcon />
                  <span>Receita</span>
                </span>
                <span className="financeiro-action-dropdown-caret" aria-hidden="true">
                  ▼
                </span>
              </button>
              {isRevenueMenuOpen ? (
                <div className="financeiro-action-dropdown-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsRevenueMenuOpen(false);
                      openNewEntryModal("receita");
                    }}
                  >
                    Avulsa
                  </button>
                  <button type="button" role="menuitem" onClick={openQuickRevenueModal}>
                    Lançamento rápido
                  </button>
                </div>
              ) : null}
            </div>
            <div className="financeiro-action-dropdown" ref={expenseMenuRef}>
              <button
                type="button"
                className="primary-button financeiro-action-button financeiro-action-button-despesa"
                onClick={() => {
                  setIsRevenueMenuOpen(false);
                  setIsExpenseMenuOpen((current) => !current);
                }}
                aria-haspopup="menu"
                aria-expanded={isExpenseMenuOpen}
              >
                <span className="button-icon-inline">
                  <PlusIcon />
                  <span>Despesa</span>
                </span>
                <span className="financeiro-action-dropdown-caret" aria-hidden="true">
                  ▼
                </span>
              </button>
              {isExpenseMenuOpen ? (
                <div className="financeiro-action-dropdown-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsExpenseMenuOpen(false);
                      openExpensePresetModal("avulsa");
                    }}
                  >
                    Avulsa
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsExpenseMenuOpen(false);
                      openExpensePresetModal("recorrente");
                    }}
                  >
                    Recorrente
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsExpenseMenuOpen(false);
                      openExpensePresetModal("parcelada");
                    }}
                  >
                    Parcelada
                  </button>
                </div>
              ) : null}
            </div>
            <div className="financeiro-month-picker-wrap">
              <button type="button" className="financeiro-month-picker-button" onClick={openMonthPicker}>
                {formatMonthRef(monthRef)}
              </button>
              <input
                ref={monthPickerRef}
                className="financeiro-month-picker-input"
                type="month"
                value={monthRef}
                onChange={(event) => setMonthRef(event.target.value)}
                aria-label={`Selecionar mês de referência (${formatMonthRef(monthRef)})`}
              />
            </div>
          </div>
        </div>

        <div className="financeiro-grid">
          <article className="financeiro-card financeiro-card-recebido">
            <h3>Recebido</h3>
            <strong className="financeiro-card-value-recebido">{formatCurrency(receivedTotal)}</strong>
          </article>
          <article className="financeiro-card financeiro-card-aguardando">
            <h3>A receber</h3>
            <strong className="financeiro-card-value-aguardando">{formatCurrency(awaitingPaymentTotal)}</strong>
          </article>
          <article className="financeiro-card">
            <h3>Pagas</h3>
            <strong className="financeiro-card-value-pagas">{formatCurrency(paidExpensesTotal)}</strong>
          </article>
          <article className="financeiro-card">
            <h3>
              <span>A pagar</span>
              <small>(hoje)</small>
            </h3>
            <strong className="financeiro-card-value-hoje">{formatCurrency(dueTodayTotal)}</strong>
            <p className="financeiro-card-subtotal">
              <span>Restante do mês</span>
              <strong className="financeiro-card-value-restante">{formatCurrency(remainingMonthTotal)}</strong>
            </p>
          </article>
          <article className="financeiro-card financeiro-card-vencidas">
            <h3>Vencidas</h3>
            <strong className="financeiro-card-value-vencidas">{formatCurrency(overdueMonthTotal)}</strong>
          </article>
        </div>
      </section>

      <section className="card financeiro-launchamentos-card">
        <div className="section-header-row">
          <h3>Lançamentos</h3>
          <div className="row">
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "todos" | FinanceEntryType)}>
              <option value="todos">Todos</option>
              <option value="receita">Receitas</option>
              <option value="despesa">Despesas</option>
            </select>
          </div>
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
            <h4>Contas vencidas</h4>
            {overview.overdue.length === 0 ? (
              <p>Sem atrasos no momento.</p>
            ) : (
              overview.overdue.map((item) => (
                <div key={`over-${item.id}`} className="financeiro-payable-item">
                  <span className="financeiro-payable-description">
                    <span>{item.description}</span>
                    <small>{`Vencimento: ${new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("pt-BR")}`}</small>
                  </span>
                  <strong>{formatCurrency(item.amount)}</strong>
                </div>
              ))
            )}
          </article>
        </div>
        <div className="financeiro-bulk-actions-slot">
          {selectedEntries.length > 0 ? (
            <div className="row financeiro-bulk-actions-row">
              <span className="muted-text">{`${selectedEntries.length} selecionado(s)`}</span>
              <button type="button" onClick={() => void onBulkMarkPaid()} disabled={bulkProcessing}>
                {bulkProcessing ? "Processando..." : "Marcar como pago"}
              </button>
              <button type="button" className="financeiro-modal-danger-button" onClick={() => void onBulkDelete()} disabled={bulkProcessing}>
                Excluir selecionados
              </button>
              <button type="button" className="financeiro-modal-cancel-button" onClick={() => setSelectedEntryIds([])} disabled={bulkProcessing}>
                Limpar seleção
              </button>
            </div>
          ) : null}
        </div>

        <div className="transaction-table-wrap">
          <table className="transaction-data-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisibleEntries} aria-label="Selecionar todos os lançamentos visíveis" />
                </th>
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
                  <td colSpan={10}>Carregando lançamentos...</td>
                </tr>
              ) : orderedEntries.length === 0 ? (
                <tr>
                  <td colSpan={10}>Nenhum lançamento encontrado.</td>
                </tr>
              ) : (
                orderedEntries.map((entry) => (
                  <tr key={entry.id}>
                    {(() => {
                      const installmentInfo = extractInstallmentInfo(entry.description);
                      return (
                        <>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedEntryIds.includes(entry.id)}
                        onChange={() => toggleSelectEntry(entry.id)}
                        aria-label={`Selecionar lançamento ${entry.description}`}
                      />
                    </td>
                    <td>{new Date(`${entry.entryDate}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                    <td>{entry.dueDate ? new Date(`${entry.dueDate}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                    <td>
                      {entry.status === "pago" ? (
                        entry.type === "receita" ? "Recebida" : "Paga"
                      ) : entry.status === "atrasado" ? (
                        "Atrasado"
                      ) : entry.type === "receita" ? (
                        "A receber"
                      ) : (
                        "Pendente"
                      )}
                    </td>
                    <td>{entry.type === "receita" ? "Receita" : "Despesa"}</td>
                    <td>{installmentInfo.installmentLabel}</td>
                    <td>{installmentInfo.description}</td>
                    <td>{entry.category || "-"}</td>
                    <td>{formatCurrency(entry.amount)}</td>
                    <td>
                      <div className="row">
                        {entry.status !== "pago" ? (
                          <button
                            type="button"
                            className="transaction-icon-button success"
                            title={entry.type === "receita" ? "Marcar como recebida" : "Marcar como paga"}
                            aria-label={entry.type === "receita" ? "Marcar como recebida" : "Marcar como paga"}
                            onClick={() => void onMarkPaid(entry)}
                          >
                            <CheckIcon />
                          </button>
                        ) : (
                          <span
                            className="transaction-status-icon paid"
                            title={entry.type === "receita" ? "Receita recebida" : "Conta paga"}
                            aria-label={entry.type === "receita" ? "Receita recebida" : "Conta paga"}
                          >
                            <CheckIcon />
                          </span>
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
              <h2>
                {editingEntryId
                  ? "Editar lançamento"
                  : entryForm.type === "receita"
                    ? "Nova receita"
                    : newExpenseMode === "recorrente"
                      ? "Nova despesa recorrente"
                      : newExpenseMode === "parcelada"
                        ? "Nova despesa parcelada"
                        : "Nova despesa avulsa"}
              </h2>
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
                {entryForm.type === "despesa" && !editingEntryId && newExpenseMode === "recorrente" ? (
                  <div className="financeiro-value-inline-options">
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
                    <label className="checkbox financeiro-inline-checkbox">
                      <input
                        type="checkbox"
                        checked={entryForm.recurringVariable}
                        onChange={(event) => setEntryForm((prev) => ({ ...prev, recurringVariable: event.target.checked }))}
                      />
                      Valor variável
                    </label>
                  </div>
                ) : (
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
                )}
              </label>

              {entryForm.type === "despesa" && !(newExpenseMode === "parcelada" && !editingEntryId) ? (
                <label>
                  Vencimento desta conta
                  <input
                    type="date"
                    value={entryForm.dueDate}
                    onChange={(event) =>
                      setEntryForm((prev) => ({
                        ...prev,
                        dueDate: event.target.value,
                        recurringDueDay: event.target.value ? event.target.value.slice(8, 10) : prev.recurringDueDay,
                      }))
                    }
                    required
                  />
                </label>
              ) : null}

              {entryForm.type === "despesa" && !editingEntryId ? (
                <>
                  {newExpenseMode === "parcelada" ? (
                    <>
                      <div className="financeiro-form-grid">
                        <label>
                          Vencimento desta conta
                          <input
                            type="date"
                            value={entryForm.dueDate}
                            onChange={(event) =>
                              setEntryForm((prev) => ({
                                ...prev,
                                dueDate: event.target.value,
                                recurringDueDay: event.target.value ? event.target.value.slice(8, 10) : prev.recurringDueDay,
                              }))
                            }
                            required
                          />
                        </label>
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
                      </div>
                      <div className="financeiro-form-grid">
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
                        {installmentPreviewLabel ? (
                          <p className="muted-text financeiro-installment-preview-inline">{`Parcelamento: ${installmentPreviewLabel}`}</p>
                        ) : null}
                      </div>
                    </>
                  ) : null}

                  {newExpenseMode === "recorrente" ? (
                    <div className="financeiro-form-grid">
                      <small className="muted-text">
                        O dia definido em "Vencimento desta conta" sera usado automaticamente nos proximos meses.
                      </small>
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

      {isQuickRevenueModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Receitas rápidas</h2>
              <button
                type="button"
                className="transaction-icon-button"
                onClick={() => setIsQuickRevenueModalOpen(false)}
                disabled={quickRevenueSaving}
                title="Fechar"
                aria-label="Fechar modal"
              >
                <CloseIcon />
              </button>
            </div>
            <p className="muted-text">
              Informe as quantidades conforme a planilha. O sistema aplica as fórmulas e lança as receitas nos dias 05 e 20 do mês{" "}
              {formatMonthRef(monthRef)}.
            </p>
            <div className="row financeiro-day-switch">
              <button
                type="button"
                className={quickRevenueDay === 5 ? "primary-button" : ""}
                onClick={() => setQuickRevenueDay(5)}
                disabled={quickRevenueSaving}
              >
                Receitas do dia 05
              </button>
              <button
                type="button"
                className={quickRevenueDay === 20 ? "primary-button" : ""}
                onClick={() => setQuickRevenueDay(20)}
                disabled={quickRevenueSaving}
              >
                Receitas do dia 20
              </button>
            </div>
            <div className="financeiro-quick-grid">
              {quickRevenueDay === 5 ? (
                <>
                  <label>
                    PIX Saque (Qtd)
                    <input
                      value={quickRevenueInputs.pixSaque}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, pixSaque: event.target.value }))}
                    />
                  </label>
                  <label>
                    Crédito Consignado (Qtd)
                    <input
                      value={quickRevenueInputs.creditoConsignado}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, creditoConsignado: event.target.value }))}
                    />
                  </label>
                  <label>
                    Recarga (Qtd)
                    <input
                      value={quickRevenueInputs.recarga}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, recarga: event.target.value }))}
                    />
                  </label>
                  <label>
                    Pagamento (Qtd)
                    <input
                      value={quickRevenueInputs.pagamento}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, pagamento: event.target.value }))}
                    />
                  </label>
                  <label>
                    Recebimento (Qtd)
                    <input
                      value={quickRevenueInputs.recebimento}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, recebimento: event.target.value }))}
                    />
                  </label>
                  <label>
                    Produção por ponto (calculado)
                    <input value={formatQuantityBase(quickRevenueProducaoPorPontoQtdBase)} disabled />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    BANESECARD (Valor)
                    <input
                      value={quickRevenueInputs.banesecard}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, banesecard: event.target.value }))}
                    />
                  </label>
                  <label>
                    Reajuste Transacional (Valor)
                    <input
                      value={quickRevenueInputs.reajusteTransacional}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, reajusteTransacional: event.target.value }))}
                    />
                  </label>
                  <label>
                    Consignado SE / Seguro (Valor)
                    <input
                      value={quickRevenueInputs.consignadoSeguro}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, consignadoSeguro: event.target.value }))}
                    />
                  </label>
                  <label>
                    LOTESE (Valor)
                    <input
                      value={quickRevenueInputs.lotese}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, lotese: event.target.value }))}
                    />
                  </label>
                  <label>
                    TV Indoor (Valor)
                    <input
                      value={quickRevenueInputs.tvIndoor}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, tvIndoor: event.target.value }))}
                    />
                  </label>
                  <label>
                    Outros (Valor)
                    <input
                      value={quickRevenueInputs.outros}
                      onChange={(event) => setQuickRevenueInputs((prev) => ({ ...prev, outros: event.target.value }))}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="financeiro-quick-extra-header">
              <strong>Campos adicionais do dia {String(quickRevenueDay).padStart(2, "0")}</strong>
              <button type="button" onClick={() => onAddQuickRevenueExtraField(quickRevenueDay)} disabled={quickRevenueSaving}>
                + Novo campo
              </button>
            </div>
            {quickRevenueExtraFields[quickRevenueDay].length > 0 ? (
              <div className="financeiro-quick-extra-list">
                {quickRevenueExtraFields[quickRevenueDay].map((field) => (
                  <div key={field.id} className="financeiro-quick-extra-row">
                    <input
                      placeholder="Nome da receita"
                      value={field.label}
                      onChange={(event) =>
                        onUpdateQuickRevenueExtraField(quickRevenueDay, field.id, { label: event.target.value })
                      }
                    />
                    <input
                      placeholder="Valor"
                      value={field.amount}
                      onChange={(event) =>
                        onUpdateQuickRevenueExtraField(quickRevenueDay, field.id, { amount: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="financeiro-modal-danger-button"
                      onClick={() => onRemoveQuickRevenueExtraField(quickRevenueDay, field.id)}
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="transaction-table-wrap">
              <table className="transaction-data-table">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Receita</th>
                    <th>Qtd base</th>
                    <th>Valor calculado</th>
                  </tr>
                </thead>
                <tbody>
                  {quickRevenueRowsByDay.map((row) => (
                    <tr key={`quick-revenue-${row.day}-${row.description}`}>
                      <td>{String(row.day).padStart(2, "0")}</td>
                      <td>{row.description}</td>
                      <td>{formatQuantityBase(row.quantity)}</td>
                      <td>{formatCurrency(row.amount)}</td>
                    </tr>
                  ))}
                  <tr className="transaction-total-row">
                    <td colSpan={3}>Total previsto</td>
                    <td>{formatCurrency(quickRevenuePreviewTotalByDay)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="primary-button" onClick={() => void onApplyQuickRevenues()} disabled={quickRevenueSaving}>
                {quickRevenueSaving ? "Aplicando..." : `Aplicar receitas do dia ${String(quickRevenueDay).padStart(2, "0")}`}
              </button>
              <button
                type="button"
                className="financeiro-modal-cancel-button"
                onClick={() => setIsQuickRevenueModalOpen(false)}
                disabled={quickRevenueSaving}
              >
                Cancelar
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteChoiceEntry ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>{deleteChoiceIsInstallment ? "Excluir parcela" : "Excluir despesa recorrente"}</h2>
              <button type="button" className="transaction-icon-button" onClick={() => setDeleteChoiceEntry(null)} title="Fechar">
                <CloseIcon />
              </button>
            </div>
            <p className="muted-text">
              {deleteChoiceIsInstallment
                ? "Este lançamento faz parte de um parcelamento. Como deseja excluir?"
                : "Este lançamento faz parte de uma recorrência mensal. Como deseja excluir?"}
            </p>
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
                {deleteChoiceIsInstallment ? "Somente este" : "Somente este mês"}
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
