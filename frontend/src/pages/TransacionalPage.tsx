import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "../contexts/AuthContext";
import {
  createTransactionTerminal,
  deleteTransactionDaily,
  getTransactionMonth,
  importTransactionDaily,
  listTransactionMonths,
  listTransactionTerminals,
  upsertTransactionDaily,
} from "../services/transactionsApi";
import { TransactionDay, TransactionMonthSummary, TransactionTerminal } from "../types";

type TransactionSortKey =
  | "terminalCode"
  | "date"
  | "authCount"
  | "saqueCount"
  | "pixSaqueCount"
  | "recargaValue"
  | "actions";
type SortDir = "asc" | "desc";

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
        d="M9 3a1 1 0 0 0-1 1v1H5a1 1 0 1 0 0 2h.2l.92 12.1A3 3 0 0 0 9.1 22h5.8a3 3 0 0 0 2.99-2.9L18.8 7H19a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9Zm2 2V5h2v0h-2Zm-2.8 2h7.6l-.9 12a1 1 0 0 1-1 .9H10.1a1 1 0 0 1-1-.9L8.2 7Zm2.3 2.2a1 1 0 0 0-1 1v6.6a1 1 0 1 0 2 0v-6.6a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v6.6a1 1 0 1 0 2 0v-6.6a1 1 0 0 0-1-1Z"
      />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm4.3 7.95-5.24 6.18a1 1 0 0 1-1.49.08l-2.2-2.2a1 1 0 0 1 1.42-1.41l1.43 1.43 4.7-5.54a1 1 0 0 1 1.52 1.3Z"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3c.37 0 .71.2.9.52l8.5 14.5a1.04 1.04 0 0 1-.9 1.55H3.5a1.04 1.04 0 0 1-.9-1.55l8.5-14.5A1.04 1.04 0 0 1 12 3Zm-1 6v5a1 1 0 1 0 2 0V9a1 1 0 1 0-2 0Zm1 9.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"
      />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 3.99a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.41l2.3 2.3V4a1 1 0 0 1 1-1ZM5 18a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.7 5.3a1 1 0 0 0-1.4 1.4L10.6 12l-5.3 5.3a1 1 0 1 0 1.4 1.4l5.3-5.3 5.3 5.3a1 1 0 1 0 1.4-1.4L13.4 12l5.3-5.3a1 1 0 0 0-1.4-1.4L12 10.6 6.7 5.3Z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 3a1 1 0 0 1 1 1v15h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm11 2a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Zm-4 4a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm-4 3a1 1 0 0 1 1 1v3a1 1 0 1 1-2 0v-3a1 1 0 0 1 1-1Z"
      />
    </svg>
  );
}

function currentMonthRef(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function monthLabel(monthRef: string): string {
  const [year, month] = monthRef.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  const label = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const raw = value.replace(/[R$\s]/g, "").trim();
  if (!raw) return 0;
  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");
  const normalized =
    hasDot && hasComma ? raw.replace(/\./g, "").replace(",", ".") : hasComma ? raw.replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateValue(value: unknown): { date: string; rawText: string } {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + Math.round(value * 24 * 60 * 60 * 1000));
    return { date: date.toISOString().slice(0, 10), rawText: String(value) };
  }
  const rawText = String(value ?? "").trim();
  if (!rawText) return { date: "", rawText };
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawText)) return { date: rawText, rawText };
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawText)) {
    return {
      date: `${rawText.slice(6, 10)}-${rawText.slice(3, 5)}-${rawText.slice(0, 2)}`,
      rawText,
    };
  }
  return { date: "", rawText };
}

export function TransacionalPage() {
  const monthInputRef = useRef<HTMLInputElement | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [monthRef, setMonthRef] = useState(currentMonthRef());
  const [terminals, setTerminals] = useState<TransactionTerminal[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState<number | null>(null);
  const [rows, setRows] = useState<TransactionDay[]>([]);
  const [months, setMonths] = useState<TransactionMonthSummary[]>([]);
  const [totals, setTotals] = useState({
    authCount: 0,
    saqueCount: 0,
    pixSaqueCount: 0,
    recargaValue: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEntryFormOpen, setIsEntryFormOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreviewCount, setImportPreviewCount] = useState(0);
  const [showImportSummary, setShowImportSummary] = useState(false);
  const [isImportPreviewOpen, setIsImportPreviewOpen] = useState(false);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRawRows, setImportRawRows] = useState<Array<Array<string | number | null>>>([]);
  const [importTerminalId, setImportTerminalId] = useState("");
  const [importMap, setImportMap] = useState({
    date: "",
    authCount: "",
    saqueCount: "",
    pixSaqueCount: "",
    recargaValue: "",
  });
  const [importMapError, setImportMapError] = useState("");
  const [pendingImportEntries, setPendingImportEntries] = useState<
    Array<{
      date: string;
      authCount: number;
      saqueCount: number;
      pixSaqueCount: number;
      recargaValue: number;
    }>
  >([]);
  const [importPreviewRows, setImportPreviewRows] = useState<
    Array<{
      line: number;
      rawDate: string;
      date: string;
      authCount: number;
      saqueCount: number;
      pixSaqueCount: number;
      recargaValue: number;
      valid: boolean;
      issue?: string;
    }>
  >([]);
  const [message, setMessage] = useState("");
  const [historyYear, setHistoryYear] = useState<number>(new Date().getFullYear());
  const [byTerminalTotals, setByTerminalTotals] = useState<
    Array<{
      terminalId: number;
      terminalCode: string;
      authCount: number;
      saqueCount: number;
      pixSaqueCount: number;
      recargaValue: number;
    }>
  >([]);
  const feedbackLabel = (text: string): string => {
    const normalized = text.toLowerCase();
    if (normalized.includes("falha") || normalized.includes("erro")) return "Erro";
    if (normalized.includes("concluída") || normalized.includes("salvo") || normalized.includes("cadastrado")) {
      return "Sucesso";
    }
    return "Aviso";
  };
  const [tableSort, setTableSort] = useState<{ key: TransactionSortKey; dir: SortDir }>({
    key: "date",
    dir: "desc",
  });
  const [form, setForm] = useState({
    terminalId: "",
    date: `${monthRef}-01`,
    authCount: "0",
    saqueCount: "0",
    pixSaqueCount: "0",
    recargaValue: "0",
  });

  const isCurrentMonth = monthRef === currentMonthRef();
  const monthInfo = useMemo(() => {
    const [year, month] = monthRef.split("-").map(Number);
    return { year, month };
  }, [monthRef]);
  const openMonthPicker = () => {
    const input = monthInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.focus();
    input.click();
  };
  const availableHistoryYears = useMemo(() => {
    const years = new Set<number>();
    for (const item of months) {
      const year = Number(item.monthRef.slice(0, 4));
      if (Number.isFinite(year) && year > 0) years.add(year);
    }
    if (!years.size) years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [months]);
  const filteredMonths = useMemo(
    () => months.filter((item) => Number(item.monthRef.slice(0, 4)) === historyYear),
    [months, historyYear],
  );
  const sortedRows = useMemo(() => {
    const factor = tableSort.dir === "asc" ? 1 : -1;
    const list = [...rows];
    list.sort((a, b) => {
      let comparison = 0;
      switch (tableSort.key) {
        case "terminalCode":
          comparison = a.terminalCode.localeCompare(b.terminalCode, "pt-BR", { numeric: true });
          break;
        case "date":
          comparison = a.date.localeCompare(b.date);
          break;
        case "authCount":
          comparison = a.authCount - b.authCount;
          break;
        case "saqueCount":
          comparison = a.saqueCount - b.saqueCount;
          break;
        case "pixSaqueCount":
          comparison = a.pixSaqueCount - b.pixSaqueCount;
          break;
        case "recargaValue":
          comparison = a.recargaValue - b.recargaValue;
          break;
        case "actions":
          comparison = a.id - b.id;
          break;
      }
      if (comparison === 0) comparison = a.id - b.id;
      return comparison * factor;
    });
    return list;
  }, [rows, tableSort]);
  const onToggleTableSort = (key: TransactionSortKey) => {
    setTableSort((current) => {
      if (current.key === key) {
        return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
  };
  const sortIndicator = (key: TransactionSortKey) => {
    if (tableSort.key !== key) return "↕";
    return tableSort.dir === "asc" ? "↑" : "↓";
  };

  async function loadData(): Promise<void> {
    setLoading(true);
    try {
      const [monthData, monthList, terminalList] = await Promise.all([
        getTransactionMonth(monthInfo.year, monthInfo.month),
        listTransactionMonths(36),
        listTransactionTerminals(),
      ]);
      setRows(monthData.items);
      setTotals(monthData.totals);
      setMonths(monthList);
      setByTerminalTotals(monthData.byTerminal ?? []);
      setTerminals(terminalList.length > 0 ? terminalList : monthData.terminals ?? []);
      setHistoryYear((prev) => {
        const selectedYear = Number(monthRef.slice(0, 4));
        if (selectedYear && selectedYear !== prev) return selectedYear;
        return prev;
      });
      setSelectedTerminalId((prev) => {
        if (prev && (terminalList.length > 0 ? terminalList : monthData.terminals ?? []).some((t) => t.id === prev)) {
          return prev;
        }
        const fallback = (terminalList.length > 0 ? terminalList : monthData.terminals ?? [])[0]?.id ?? null;
        return fallback;
      });
    } catch {
      setMessage("Falha ao carregar dados do transacional.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [monthRef]);

  useEffect(() => {
    setForm((prev) => {
      const [year, month] = monthRef.split("-");
      const nextDate = isCurrentMonth
        ? new Date().toISOString().slice(0, 10)
        : `${year}-${month}-01`;
      const nextTerminalId = selectedTerminalId ? String(selectedTerminalId) : prev.terminalId;
      const sameMonth = prev.date.startsWith(`${year}-${month}`);
      if (sameMonth && prev.terminalId === nextTerminalId) return prev;
      return { ...prev, date: sameMonth ? prev.date : nextDate, terminalId: nextTerminalId };
    });
  }, [monthRef, isCurrentMonth, selectedTerminalId]);

  useEffect(() => {
    setImportTerminalId((prev) => {
      if (prev) return prev;
      const fallback = selectedTerminalId || Number(form.terminalId || 0);
      return fallback ? String(fallback) : "";
    });
  }, [selectedTerminalId, form.terminalId]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const terminalId = Number(form.terminalId || selectedTerminalId || 0);
    if (!terminalId) {
      setMessage("Selecione um terminal.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await upsertTransactionDaily({
        terminalId,
        date: form.date,
        authCount: Number(form.authCount || 0),
        saqueCount: Number(form.saqueCount || 0),
        pixSaqueCount: Number(form.pixSaqueCount || 0),
        recargaValue: Number(String(form.recargaValue).replace(",", ".") || 0),
      });
      setMessage("Lançamento salvo.");
      const [year, month] = monthRef.split("-");
      setForm({
        terminalId: selectedTerminalId ? String(selectedTerminalId) : "",
        date: isCurrentMonth ? new Date().toISOString().slice(0, 10) : `${year}-${month}-01`,
        authCount: "0",
        saqueCount: "0",
        pixSaqueCount: "0",
        recargaValue: "0",
      });
      setIsEntryFormOpen(false);
      await loadData();
    } catch {
      setMessage("Falha ao salvar lançamento.");
    } finally {
      setSaving(false);
    }
  };

  const onEditRow = (row: TransactionDay) => {
    setIsEntryFormOpen(true);
    setForm({
      terminalId: String(row.terminalId),
      date: row.date,
      authCount: String(row.authCount),
      saqueCount: String(row.saqueCount),
      pixSaqueCount: String(row.pixSaqueCount),
      recargaValue: String(row.recargaValue),
    });
    setSelectedTerminalId(row.terminalId);
  };

  const onDeleteRow = async (row: TransactionDay) => {
    const ok = window.confirm(`Excluir lançamento do dia ${new Date(`${row.date}T00:00:00`).toLocaleDateString("pt-BR")}?`);
    if (!ok) return;
    try {
      await deleteTransactionDaily(row.id);
      setMessage("Lançamento excluído.");
      await loadData();
    } catch {
      setMessage("Falha ao excluir lançamento.");
    }
  };

  const onAddTerminal = async () => {
    const code = window.prompt("Informe o código do novo terminal (ex.: 260):");
    const normalizedCode = (code ?? "").trim();
    if (!normalizedCode) return;
    try {
      const created = await createTransactionTerminal({ code: normalizedCode, name: `Terminal ${normalizedCode}` });
      setTerminals((prev) => [...prev, created].sort((a, b) => a.code.localeCompare(b.code)));
      setSelectedTerminalId(created.id);
      setForm((prev) => ({ ...prev, terminalId: String(created.id) }));
      setMessage(`Terminal ${created.code} cadastrado.`);
    } catch {
      setMessage("Falha ao cadastrar terminal.");
    }
  };

  const rebuildImportPreview = (
    headers: string[],
    bodyRows: Array<Array<string | number | null>>,
    map: {
      date: string;
      authCount: string;
      saqueCount: string;
      pixSaqueCount: string;
      recargaValue: string;
    },
  ) => {
    if (!headers.length || !bodyRows.length) {
      setPendingImportEntries([]);
      setImportPreviewRows([]);
      return;
    }
    if (!map.date || !map.authCount || !map.saqueCount || !map.pixSaqueCount || !map.recargaValue) {
      setPendingImportEntries([]);
      setImportPreviewRows([]);
      setImportMapError("Selecione o mapeamento de todos os campos obrigatórios.");
      return;
    }
    const idxDate = headers.findIndex((h) => h === map.date);
    const idxAuth = headers.findIndex((h) => h === map.authCount);
    const idxSaque = headers.findIndex((h) => h === map.saqueCount);
    const idxPix = headers.findIndex((h) => h === map.pixSaqueCount);
    const idxRecarga = headers.findIndex((h) => h === map.recargaValue);
    if ([idxDate, idxAuth, idxSaque, idxPix, idxRecarga].some((idx) => idx < 0)) {
      setPendingImportEntries([]);
      setImportPreviewRows([]);
      setImportMapError("Mapeamento inválido.");
      return;
    }
    const parsedRows = bodyRows.map((row, index) => {
      const parsedDate = parseDateValue(row[idxDate]);
      if (!parsedDate.date) {
        return {
          line: index + 2,
          rawDate: parsedDate.rawText,
          date: "",
          authCount: 0,
          saqueCount: 0,
          pixSaqueCount: 0,
          recargaValue: 0,
          valid: false,
          issue: "Data inválida (use YYYY-MM-DD, DD/MM/YYYY ou número Excel).",
        };
      }
      return {
        line: index + 2,
        rawDate: parsedDate.rawText,
        date: parsedDate.date,
        authCount: Math.max(0, Math.round(parseNumber(row[idxAuth]))),
        saqueCount: Math.max(0, Math.round(parseNumber(row[idxSaque]))),
        pixSaqueCount: Math.max(0, Math.round(parseNumber(row[idxPix]))),
        recargaValue: Math.max(0, parseNumber(row[idxRecarga])),
        valid: true,
      };
    });
    const entries = parsedRows
      .filter((item) => item.valid)
      .map((item) => ({
        date: item.date,
        authCount: item.authCount,
        saqueCount: item.saqueCount,
        pixSaqueCount: item.pixSaqueCount,
        recargaValue: item.recargaValue,
      }));
    setImportMapError("");
    setPendingImportEntries(entries);
    setImportPreviewRows(parsedRows.slice(0, 25));
  };

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rowsRaw = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
        header: 1,
        blankrows: false,
      });
      if (rowsRaw.length <= 1) {
        setMessage("Arquivo vazio para importação.");
        return;
      }
      const headers = (rowsRaw[0] ?? []).map((value) => String(value ?? "").trim());
      const normalizedHeaders = headers.map((header) => normalizeHeader(header));
      const findColumn = (candidates: string[]) => {
        const index = normalizedHeaders.findIndex((header) => candidates.includes(header));
        return index >= 0 ? headers[index] : "";
      };
      const nextMap = {
        date: findColumn(["data", "date", "dia"]),
        authCount: findColumn(["autenticacao", "autenticacaoqtd", "auth", "authcount"]),
        saqueCount: findColumn(["saque", "saqueqtd", "saquecount"]),
        pixSaqueCount: findColumn(["pixsaque", "pixsaqueqtd", "pix"]),
        recargaValue: findColumn(["recarga", "recargavalor", "valorrecarga"]),
      };
      const bodyRows = rowsRaw.slice(1);
      setImportHeaders(headers);
      setImportRawRows(bodyRows);
      setImportMap(nextMap);
      rebuildImportPreview(headers, bodyRows, nextMap);
      setIsImportPreviewOpen(true);
      setMessage("Arquivo lido. Revise o mapeamento antes de confirmar.");
    } catch {
      setMessage("Falha ao ler arquivo para importação.");
    } finally {
      event.target.value = "";
    }
  };

  const onConfirmImport = async () => {
    if (pendingImportEntries.length === 0) {
      setMessage(importMapError || "Sem linhas válidas para importar.");
      return;
    }
    const terminalId = Number(importTerminalId || selectedTerminalId || form.terminalId || 0);
    if (!terminalId) {
      setMessage("Selecione um terminal antes de confirmar importação.");
      return;
    }
    setImporting(true);
    try {
      const result = await importTransactionDaily({ terminalId, entries: pendingImportEntries });
      setImportPreviewCount(result.importedRows);
      setShowImportSummary(true);
      window.setTimeout(() => setShowImportSummary(false), 5000);
      setIsImportPreviewOpen(false);
      setPendingImportEntries([]);
      setMessage(`Importação concluída. ${result.importedRows} lançamentos processados.`);
      await loadData();
    } catch {
      setMessage("Falha ao importar arquivo.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="transaction-page">
      <section className="card">
        <div className="section-header-row transaction-top-header">
          <h2 className="loan-title-icon-label">
            <ChartIcon />
            <span>Transacional</span>
          </h2>
          <div className="row transaction-top-controls">
            {isAdmin ? (
              <button type="button" onClick={onAddTerminal}>
                + Terminal
              </button>
            ) : null}
            <button
              type="button"
              className="transaction-top-action transaction-top-action-new"
              onClick={() => {
                const [year, month] = monthRef.split("-");
                setForm((prev) => ({
                  ...prev,
                  terminalId: prev.terminalId || (selectedTerminalId ? String(selectedTerminalId) : ""),
                  date: isCurrentMonth ? new Date().toISOString().slice(0, 10) : `${year}-${month}-01`,
                  authCount: "0",
                  saqueCount: "0",
                  pixSaqueCount: "0",
                  recargaValue: "0",
                }));
                setIsEntryFormOpen(true);
              }}
            >
              <span className="button-icon-inline">
                <PlusIcon />
                <span>Novo</span>
              </span>
            </button>
            <label className="transaction-import-label transaction-top-action transaction-top-action-import">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={onImportFile}
                disabled={importing}
                className="transaction-import-input"
              />
              <span className="button-icon-inline">
                <ImportIcon />
                <span>{importing ? "Importando..." : "Importar"}</span>
              </span>
            </label>
            <input
              ref={monthInputRef}
              type="month"
              className="transaction-month-input"
              value={monthRef}
              onMouseDown={(event) => {
                event.preventDefault();
                openMonthPicker();
              }}
              onFocus={openMonthPicker}
              onChange={(e) => setMonthRef(e.target.value)}
            />
          </div>
        </div>
        <div className="transaction-kpis">
          <article className="transaction-kpi">
            <small>Autenticação (mês)</small>
            <strong>{totals.authCount}</strong>
          </article>
          <article className="transaction-kpi">
            <small>Saque (mês)</small>
            <strong>{totals.saqueCount}</strong>
          </article>
          <article className="transaction-kpi">
            <small>PIX Saque (mês)</small>
            <strong>{totals.pixSaqueCount}</strong>
          </article>
          <article className="transaction-kpi">
            <small>Recarga (mês)</small>
            <strong>{formatCurrency(totals.recargaValue)}</strong>
          </article>
        </div>
        <div className="transaction-terminal-kpis">
          {byTerminalTotals.map((terminal) => (
            <article key={terminal.terminalId} className="transaction-terminal-kpi">
              <strong>Terminal {terminal.terminalCode}</strong>
              <small>
                Autenticação: {terminal.authCount} | Saque: {terminal.saqueCount} | PIX Saque: {terminal.pixSaqueCount} | Recarga:{" "}
                {formatCurrency(terminal.recargaValue)}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="card transaction-layout">
        <div>
          {showImportSummary ? (
            <small className="muted-text transaction-last-import">
              Última importação: {importPreviewCount} linhas processadas.
            </small>
          ) : null}

          <div className="transaction-table-wrap">
            <table className="transaction-data-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => onToggleTableSort("terminalCode")}>
                      Terminal <span>{sortIndicator("terminalCode")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => onToggleTableSort("date")}>
                      Data <span>{sortIndicator("date")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => onToggleTableSort("authCount")}>
                      Autenticação <span>{sortIndicator("authCount")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => onToggleTableSort("saqueCount")}>
                      Saque <span>{sortIndicator("saqueCount")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => onToggleTableSort("pixSaqueCount")}>
                      PIX Saque <span>{sortIndicator("pixSaqueCount")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => onToggleTableSort("recargaValue")}>
                      Recarga <span>{sortIndicator("recargaValue")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => onToggleTableSort("actions")}>
                      Ações <span>{sortIndicator("actions")}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7}>Carregando lançamentos...</td>
                  </tr>
                ) : sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>Nenhum lançamento neste mês.</td>
                  </tr>
                ) : (
                  sortedRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.terminalCode}</td>
                      <td>{new Date(`${row.date}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                      <td>{row.authCount}</td>
                      <td>{row.saqueCount}</td>
                      <td>{row.pixSaqueCount}</td>
                      <td>{formatCurrency(row.recargaValue)}</td>
                      <td>
                        <div className="row">
                          <button
                            type="button"
                            className="transaction-icon-button"
                            title="Editar lançamento"
                            aria-label="Editar lançamento"
                            onClick={() => onEditRow(row)}
                          >
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            className="transaction-icon-button danger"
                            title="Excluir lançamento"
                            aria-label="Excluir lançamento"
                            onClick={() => onDeleteRow(row)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
                <tr className="transaction-total-row">
                  <td>Total geral do mês</td>
                  <td>-</td>
                  <td>{totals.authCount}</td>
                  <td>{totals.saqueCount}</td>
                  <td>{totals.pixSaqueCount}</td>
                  <td>{formatCurrency(totals.recargaValue)}</td>
                  <td>-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <aside className="transaction-months-panel">
          <div className="section-header-row transaction-months-header">
            <h3>Histórico de meses</h3>
            <select
              className="transaction-year-select"
              value={String(historyYear)}
              onChange={(event) => setHistoryYear(Number(event.target.value || 0))}
            >
              {availableHistoryYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div className="transaction-months-list">
            {filteredMonths.map((item) => (
              <button
                type="button"
                key={item.monthRef}
                className={`transaction-month-item ${item.monthRef === monthRef ? "active" : ""}`}
                onClick={() => setMonthRef(item.monthRef)}
              >
                <strong>{monthLabel(item.monthRef)}</strong>
                <small>{item.daysCount} dias</small>
                <small>Autenticação: {item.authCount}</small>
                <small>Saque: {item.saqueCount}</small>
                <small>PIX Saque: {item.pixSaqueCount}</small>
                <small>Recarga: {formatCurrency(item.recargaValue)}</small>
              </button>
            ))}
          </div>
        </aside>
      </section>
      {isEntryFormOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card transaction-entry-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Novo lançamento</h2>
              <button type="button" onClick={() => setIsEntryFormOpen(false)}>
                X
              </button>
            </div>
            <p className="section-subtitle transaction-entry-subtitle">
              Preencha os dados do terminal e confirme o lançamento do dia.
            </p>
            <form className="form-stack transaction-form" onSubmit={onSubmit}>
              <div className="transaction-form-grid">
                <label>
                  Terminal
                  <select
                    value={form.terminalId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setForm((p) => ({ ...p, terminalId: next }));
                      setSelectedTerminalId(Number(next || 0) || null);
                    }}
                    required
                  >
                    <option value="">Selecione</option>
                    {terminals.map((terminal) => (
                      <option key={terminal.id} value={terminal.id}>
                        {terminal.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Data
                  <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} required />
                </label>
                <label>
                  Autenticação (Qtd)
                  <input
                    type="number"
                    min={0}
                    value={form.authCount}
                    onChange={(e) => setForm((p) => ({ ...p, authCount: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Saque (Qtd)
                  <input
                    type="number"
                    min={0}
                    value={form.saqueCount}
                    onChange={(e) => setForm((p) => ({ ...p, saqueCount: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  PIX Saque (Qtd)
                  <input
                    type="number"
                    min={0}
                    value={form.pixSaqueCount}
                    onChange={(e) => setForm((p) => ({ ...p, pixSaqueCount: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Recarga (R$)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.recargaValue}
                    onChange={(e) => setForm((p) => ({ ...p, recargaValue: e.target.value }))}
                    required
                  />
                </label>
                <div className="transaction-submit-cell">
                  <button className="primary-button" type="submit" disabled={saving}>
                    {saving ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {message ? <p className="copy-feedback">{`${feedbackLabel(message)}: ${message}`}</p> : null}
      {isImportPreviewOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Pré-visualização da importação</h2>
              <button type="button" onClick={() => setIsImportPreviewOpen(false)}>
                X
              </button>
            </div>
            <p className="section-subtitle">
              Linhas válidas: {pendingImportEntries.length} | Com erro:{" "}
              {importPreviewRows.filter((item) => !item.valid).length}
            </p>
            <div className="row">
              <label>
                Terminal da importação
                <select
                  value={importTerminalId}
                  onChange={(event) => setImportTerminalId(event.target.value)}
                  required
                >
                  <option value="">Selecione</option>
                  {terminals.map((terminal) => (
                    <option key={`import-terminal-${terminal.id}`} value={terminal.id}>
                      {terminal.code}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="transaction-import-map">
              <label>
                Data
                <select
                  value={importMap.date}
                  onChange={(event) => {
                    const nextMap = { ...importMap, date: event.target.value };
                    setImportMap(nextMap);
                    rebuildImportPreview(importHeaders, importRawRows, nextMap);
                  }}
                >
                  <option value="">Selecione</option>
                  {importHeaders.map((header) => (
                    <option key={`date-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Autenticação
                <select
                  value={importMap.authCount}
                  onChange={(event) => {
                    const nextMap = { ...importMap, authCount: event.target.value };
                    setImportMap(nextMap);
                    rebuildImportPreview(importHeaders, importRawRows, nextMap);
                  }}
                >
                  <option value="">Selecione</option>
                  {importHeaders.map((header) => (
                    <option key={`auth-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Saque
                <select
                  value={importMap.saqueCount}
                  onChange={(event) => {
                    const nextMap = { ...importMap, saqueCount: event.target.value };
                    setImportMap(nextMap);
                    rebuildImportPreview(importHeaders, importRawRows, nextMap);
                  }}
                >
                  <option value="">Selecione</option>
                  {importHeaders.map((header) => (
                    <option key={`saque-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                PIX Saque
                <select
                  value={importMap.pixSaqueCount}
                  onChange={(event) => {
                    const nextMap = { ...importMap, pixSaqueCount: event.target.value };
                    setImportMap(nextMap);
                    rebuildImportPreview(importHeaders, importRawRows, nextMap);
                  }}
                >
                  <option value="">Selecione</option>
                  {importHeaders.map((header) => (
                    <option key={`pix-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Recarga
                <select
                  value={importMap.recargaValue}
                  onChange={(event) => {
                    const nextMap = { ...importMap, recargaValue: event.target.value };
                    setImportMap(nextMap);
                    rebuildImportPreview(importHeaders, importRawRows, nextMap);
                  }}
                >
                  <option value="">Selecione</option>
                  {importHeaders.map((header) => (
                    <option key={`recarga-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {importMapError ? <p className="copy-feedback">{`Aviso: ${importMapError}`}</p> : null}
            <div className="transaction-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Data</th>
                    <th>Autenticação</th>
                    <th>Saque</th>
                    <th>PIX Saque</th>
                    <th>Recarga</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreviewRows.map((row) => (
                    <tr key={`${row.line}-${row.rawDate}`} className={row.valid ? "" : "transaction-preview-error"}>
                      <td>{row.line}</td>
                      <td>{row.date || row.rawDate || "-"}</td>
                      <td>{row.authCount}</td>
                      <td>{row.saqueCount}</td>
                      <td>{row.pixSaqueCount}</td>
                      <td>{formatCurrency(row.recargaValue)}</td>
                      <td>
                        {row.valid ? (
                          <span className="transaction-status-chip success">
                            <SuccessIcon />
                            <span>OK</span>
                          </span>
                        ) : (
                          <span className="transaction-status-chip error">
                            <WarningIcon />
                            <span>{row.issue}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <button
                type="button"
                className="primary-button"
                onClick={onConfirmImport}
                disabled={importing || pendingImportEntries.length === 0}
              >
                <span className="button-icon-inline">
                  <ImportIcon />
                  <span>{importing ? "Importando..." : "Confirmar importação"}</span>
                </span>
              </button>
              <button type="button" onClick={() => setIsImportPreviewOpen(false)} disabled={importing}>
                <span className="button-icon-inline">
                  <CloseIcon />
                  <span>Cancelar</span>
                </span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
