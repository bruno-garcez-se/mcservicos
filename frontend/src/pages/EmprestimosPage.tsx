import { CSSProperties, ChangeEvent, FormEvent, Fragment, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "../contexts/AuthContext";
import {
  createLoanClient,
  createLoanInteraction,
  createLoanProduct,
  createLoanSimulation,
  deleteLoanClient,
  completeLoanAgendaItem,
  getLoanClientById,
  getLoanDashboard,
  getLoanSettings,
  getProgressoImportacaoServidores,
  importarServidoresPortal,
  importLoanLeads,
  listLoanAgenda,
  listServidoresImportados,
  listRubricasDescontoServidores,
  listLoanSellers,
  listLoanClients,
  listLoanInteractions,
  listLoanProducts,
  listLoanSimulations,
  markLoanClientActivityTouch,
  simularServidorAgora,
  updateLoanClient,
  updateLoanClientHeatBadge,
  updateLoanSettings,
  updateLoanClientStatus,
  rescheduleLoanAgendaItem,
} from "../services/loansApi";
import { ImportedServant, LoanAgendaItem, LoanClient, LoanClientStatus, LoanProductType } from "../types";

const statusFlow: Array<{ key: LoanClientStatus; label: string }> = [
  { key: "novo", label: "Novo" },
  { key: "em_atendimento", label: "Em atendimento" },
  { key: "simulacao", label: "Simulação" },
  { key: "em_analise", label: "Em analise" },
  { key: "digitacao", label: "Digitacao" },
  { key: "seguro_ap", label: "Seguro AP" },
  { key: "assinatura", label: "Assinatura" },
  { key: "pagamento", label: "Pagamento" },
  { key: "ganho", label: "Ganho" },
  { key: "perdido", label: "Perdido" },
];
const EMPTY_KANBAN_TOTALS = statusFlow.reduce(
  (acc, item) => ({ ...acc, [item.key]: 0 }),
  {} as Record<LoanClientStatus, number>,
);
const EMPTY_KANBAN_CARDS = statusFlow.reduce(
  (acc, item) => ({ ...acc, [item.key]: [] as LoanClient[] }),
  {} as Record<LoanClientStatus, LoanClient[]>,
);
type CadastroSortBy =
  | "name"
  | "cpf"
  | "city"
  | "profession"
  | "convenio"
  | "assignedUserName"
  | "status"
  | "updatedAt";
type SortDir = "asc" | "desc";
type LoanDashboardState = {
  totalClients: number;
  conversions: number;
  wonClients: number;
  lostClients: number;
  noContactClients: number;
  statusBreakdown: Array<{ status: string; total: number }>;
  interactionsByDay: Array<{ day: string; total: number }>;
  productsMostSold: Array<{ product_type: string; total: number }>;
};
type LoanClientsListResponse = Awaited<ReturnType<typeof listLoanClients>>;

const DEFAULT_MESSAGE_TEMPLATES = [
  "Oi {nome}, tudo bem? Posso te enviar as melhores opções de crédito agora?",
  "Oi {nome}, separei uma simulação para você. Posso te explicar em 2 minutos?",
  "Oi {nome}, sua proposta evoluiu. Posso confirmar alguns dados rápidos?",
];
const TEMPLATE_LIBRARY_STORAGE_KEY = "mcservicos_whatsapp_templates";
const TEMPLATE_TAGS_HELP: Array<{ key: string; description: string }> = [
  { key: "{saudacao}", description: "Bom dia / Boa tarde / Boa noite" },
  { key: "{primeiro_nome}", description: "Primeiro nome do cliente" },
  { key: "{nome_completo}", description: "Nome completo do cliente" },
  { key: "{nome}", description: "Nome completo do cliente (compatibilidade)" },
  { key: "{telefone}", description: "Telefone principal" },
  { key: "{cpf}", description: "CPF formatado" },
  { key: "{cidade}", description: "Cidade" },
  { key: "{profissao}", description: "Profissão" },
  { key: "{convenio}", description: "Convênio" },
  { key: "{renda}", description: "Renda formatada" },
  { key: "{status}", description: "Status no funil" },
  { key: "{origem}", description: "Origem do lead" },
  { key: "{vendedor}", description: "Vendedor responsável" },
  { key: "{margem}", description: "Margem disponível formatada" },
];

function isDefaultTemplate(template: string): boolean {
  const normalized = template.trim().toLowerCase();
  return DEFAULT_MESSAGE_TEMPLATES.some((item) => item.trim().toLowerCase() === normalized);
}

function getSaudacao(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}
const INTERACTION_CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "presencial", label: "Presencial" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telefone", label: "Telefone" },
  { value: "email", label: "E-mail" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "indicacao", label: "Indicação" },
];

const locales = {
  "pt-BR": ptBR,
};

const agendaCalendarLocalizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});
const DragAndDropCalendar = withDragAndDrop(Calendar);

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function formatCpf(value: string): string {
  const digits = onlyDigits(value).slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatPhone(value: string): string {
  const digits = onlyDigits(value).slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function monthRefLabel(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const date = new Date(year, Math.max(0, month - 1), 1);
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function formatPhonesDisplay(phones: string[], emptyText = "-"): string {
  if (!Array.isArray(phones) || phones.length === 0) return emptyText;
  return phones.join(" / ");
}

function toDateTimeLocalValue(date: Date): string {
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safe.getFullYear();
  const month = String(safe.getMonth() + 1).padStart(2, "0");
  const day = String(safe.getDate()).padStart(2, "0");
  const hours = String(safe.getHours()).padStart(2, "0");
  const minutes = String(safe.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getDefaultScheduleDateTimeLocal(): string {
  return toDateTimeLocalValue(new Date(Date.now() + 30 * 60 * 1000));
}

function getChannelLabel(channel: string): string {
  const normalized = channel.trim().toLowerCase();
  if (normalized === "manual" || normalized === "presencial") return "Presencial";
  return INTERACTION_CHANNEL_OPTIONS.find((item) => item.value === normalized)?.label ?? channel;
}

function extractApiMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error &&
    "response" in error &&
    typeof (error as { response?: unknown }).response === "object" &&
    (error as { response?: { data?: unknown } }).response &&
    "data" in (error as { response: { data?: unknown } }).response
  ) {
    const data = (error as { response: { data?: unknown } }).response.data;
    if (typeof data === "string" && data.trim()) return data;
    if (typeof data === "object" && data && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M12 2a10 10 0 0 0-8.73 14.88L2 22l5.27-1.24A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4.06-1.1l-.29-.17-3.13.74.74-3.04-.19-.31A8 8 0 1 1 12 20Zm4.52-5.95c-.25-.13-1.46-.72-1.69-.8-.23-.09-.39-.13-.56.13-.17.25-.64.8-.79.97-.15.17-.29.2-.54.07-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.38-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.07-.13-.56-1.36-.77-1.86-.2-.48-.4-.41-.56-.42h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.76 2.68 4.26 3.76.59.25 1.06.4 1.42.51.6.19 1.14.16 1.57.1.48-.07 1.46-.6 1.67-1.17.21-.57.21-1.06.15-1.17-.06-.1-.23-.17-.48-.29Z"
        fill="currentColor"
      />
    </svg>
  );
}

function TemplateSendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.6 4.4a1 1 0 0 1 1.05-.2l15.5 6.2a1 1 0 0 1 0 1.86l-15.5 6.2a1 1 0 0 1-1.36-1.17L4.5 12 3.29 5.57a1 1 0 0 1 .31-1.17Zm2 2.62.85 4.52h8.42L5.6 7.02Zm0 9.96 9.27-4.56H6.45l-.85 4.56Z"
      />
    </svg>
  );
}

function SimulatorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M7 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H7Zm0 2h10a1 1 0 0 1 1 1v3H6V5a1 1 0 0 1 1-1Zm-1 7h3v3H6v-3Zm5 0h3v3h-3v-3Zm5 0h2v3h-2v-3ZM6 16h3v3H6v-3Zm5 0h3v3h-3v-3Zm5 0h2v3h-2v-3Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M12.3 6.3a1 1 0 0 0 0 1.4l3.3 3.3H4a1 1 0 1 0 0 2h11.6l-3.3 3.3a1 1 0 1 0 1.4 1.4l5-5a1 1 0 0 0 0-1.4l-5-5a1 1 0 0 0-1.4 0Z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="m3 17.25 9.81-9.81 2.75 2.75L5.75 20H3v-2.75Zm14.71-8.79-2.75-2.75 1.39-1.39a1 1 0 0 1 1.41 0l1.34 1.34a1 1 0 0 1 0 1.41l-1.39 1.39Z"
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

function CheckActionIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1.1 13.3-3-3a1 1 0 1 1 1.4-1.4l1.97 1.97 3.82-4.77a1 1 0 0 1 1.56 1.24l-4.5 5.63a1 1 0 0 1-1.46.13Z" />
    </svg>
  );
}

function CheckDoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1.2 13.2-2.8-2.8a1 1 0 0 1 1.4-1.4l1.7 1.7 3.6-4.5a1 1 0 0 1 1.56 1.24l-4.3 5.37a1 1 0 0 1-1.46.13Zm5.6-2.6a1 1 0 1 1 1.4 1.4l-4.3 4.3a1 1 0 0 1-1.4 0l-.85-.85a1 1 0 0 1 1.4-1.4l.15.14 3.6-3.59Z" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 12a1 1 0 0 1 1-1h3.38l1.72-3.45a1 1 0 0 1 1.83.09l2.2 6.6 1.03-2.06A1 1 0 0 1 16.06 11H19a1 1 0 1 1 0 2h-2.32l-1.79 3.58a1 1 0 0 1-1.88-.13l-2.22-6.68-1.1 2.2A1 1 0 0 1 8.8 13H5a1 1 0 0 1-1-1Z"
      />
    </svg>
  );
}

function CalendarPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v5a1 1 0 1 1-2 0V8H5v11a1 1 0 0 0 1 1h5a1 1 0 1 1 0 2H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1Zm10 10a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2h-2a1 1 0 0 1 0-2h2v-2a1 1 0 0 1 1-1Z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z" />
    </svg>
  );
}

function OpenClientIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M12 5c5.2 0 9.7 3.1 11 7-1.3 3.9-5.8 7-11 7S2.3 15.9 1 12c1.3-3.9 5.8-7 11-7Zm0 2c-4.1 0-7.7 2.2-9 5 1.3 2.8 4.9 5 9 5s7.7-2.2 9-5c-1.3-2.8-4.9-5-9-5Zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
    </svg>
  );
}

function MenuCadastroIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M12 3a5 5 0 1 1-3.54 1.46A5 5 0 0 1 12 3Zm0 12c3.87 0 7 2.01 7 4.5V21H5v-1.5C5 17.01 8.13 15 12 15Z" />
    </svg>
  );
}

function MenuFunilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 .8 1.6L14 14.5V20a1 1 0 0 1-1.45.9l-3-1.5A1 1 0 0 1 9 18.5v-4L3.2 5.6A1 1 0 0 1 3 5Z" />
    </svg>
  );
}

function MenuAgendaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1Zm12 7H5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9Zm-9 3h4a1 1 0 1 1 0 2h-4a1 1 0 1 1 0-2Z" />
    </svg>
  );
}

function MenuImportIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29a1 1 0 1 1 1.4 1.41l-4 3.99a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.41L11 12.59V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function MenuComissaoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm.05 3.2c1.52 0 2.75.46 3.86 1.28a1 1 0 1 1-1.2 1.6c-.76-.56-1.63-.88-2.71-.88-1.24 0-2.04.52-2.04 1.35 0 .87.86 1.22 2.64 1.66 2.13.54 4.19 1.36 4.19 3.95 0 2.18-1.65 3.55-3.79 3.87V20a1 1 0 1 1-2 0v-1.46c-1.44-.2-2.72-.8-3.87-1.77a1 1 0 1 1 1.29-1.52c1.02.86 2.12 1.32 3.43 1.32 1.34 0 2.06-.54 2.06-1.36 0-.94-.84-1.29-2.79-1.78-2.1-.53-4.03-1.36-4.03-3.83 0-2.08 1.58-3.5 3.91-3.82V4.95a1 1 0 1 1 2 0V5.7Z"
      />
    </svg>
  );
}

function EmptyStageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h4.59l1.7 1.71a1 1 0 0 0 1.42 0L14.41 17H19a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5Zm0 2h14v9h-5a1 1 0 0 0-.71.29L12 16.59l-1.29-1.3A1 1 0 0 0 10 15H5V6Zm3 3a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H8Z"
      />
    </svg>
  );
}

type ImportFieldMap = {
  name: string;
  cpf: string;
  phone: string;
  city: string;
  profession: string;
  convenio: string;
  income: string;
  source: string;
};

const emptyMap: ImportFieldMap = {
  name: "",
  cpf: "",
  phone: "",
  city: "",
  profession: "",
  convenio: "",
  income: "",
  source: "",
};
const KANBAN_FILTERS_STORAGE_KEY = "mcservicos_kanban_filters";
const SERVIDORES_FILTERS_STORAGE_KEY = "mcservicos_servidores_filters";
const CADASTRO_FILTERS_STORAGE_KEY = "mcservicos_cadastro_filters";
const LEAD_SOURCES_STORAGE_KEY = "mcservicos_lead_sources";
const CONVENIOS_STORAGE_KEY = "mcservicos_convenios";
const LOAN_VIEW_CACHE_TTL_MS = 15000;

export function EmprestimosPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [clients, setClients] = useState<LoanClient[]>([]);
  const [products, setProducts] = useState<
    Array<{
      id: number;
      name: string;
      productType: LoanProductType;
      defaultRate: number;
      minTerm: number;
      maxTerm: number;
      active: boolean;
    }>
  >([]);
  const [dashboard, setDashboard] = useState<LoanDashboardState | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [interactions, setInteractions] = useState<
    Array<{
      id: number;
      notes: string;
      channel: string;
      createdAt: string;
      scheduledFor?: string | null;
      completedAt?: string | null;
      userName?: string;
    }>
  >([]);
  const [agendaItems, setAgendaItems] = useState<LoanAgendaItem[]>([]);
  const [agendaStatusFilter, setAgendaStatusFilter] = useState<"all" | "pending" | "completed">("all");
  const [agendaViewMode, setAgendaViewMode] = useState<"calendar" | "list">(() => {
    try {
      const saved = localStorage.getItem("loan:agenda-view");
      if (saved === "calendar" || saved === "list") return saved;
    } catch {
      // Ignora falha de storage.
    }
    return "calendar";
  });
  const [isQuickAgendaModalOpen, setIsQuickAgendaModalOpen] = useState(false);
  const [isSavingQuickAgenda, setIsSavingQuickAgenda] = useState(false);
  const [quickAgendaForm, setQuickAgendaForm] = useState({
    clientId: "",
    channel: "presencial",
    notes: "",
    scheduledFor: "",
  });
  const [simulations, setSimulations] = useState<
    Array<{
      id: number;
      productType: LoanProductType;
      principal: number;
      installments: number;
      monthlyRate: number;
      installmentValue: number;
      totalPaid: number;
      effectiveCost: number;
      isBest: boolean;
      createdAt: string;
    }>
  >([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loanSection, setLoanSection] = useState<
    "cadastro" | "funil" | "agenda" | "importacoes" | "comissao"
  >("funil");

  const [clientForm, setClientForm] = useState({
    name: "",
    cpf: "",
    phones: [""],
    city: "",
    profession: "",
    convenio: "INSS",
    income: "",
    heatBadge: null as "Quente" | "Morno" | "Frio" | null,
    source: "manual",
    status: "novo" as LoanClientStatus,
    assignedUserId: user?.id ?? 0,
    assignedUserName: user?.name ?? "",
  });
  const [sellerOptions, setSellerOptions] = useState<Array<{ id: number; name: string; email: string }>>([]);
  const [isSellerModalOpen, setIsSellerModalOpen] = useState(false);
  const [interactionText, setInteractionText] = useState("");
  const [interactionChannel, setInteractionChannel] = useState("presencial");
  const [interactionScheduledFor, setInteractionScheduledFor] = useState("");
  const [templateLibrary, setTemplateLibrary] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(TEMPLATE_LIBRARY_STORAGE_KEY);
      if (!raw) return [...DEFAULT_MESSAGE_TEMPLATES];
      const parsed = JSON.parse(raw) as { items?: unknown };
      if (!parsed || !Array.isArray(parsed.items)) return [...DEFAULT_MESSAGE_TEMPLATES];
      const normalized = parsed.items
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
      if (normalized.length === 0) return [...DEFAULT_MESSAGE_TEMPLATES];
      return [...new Set([...normalized, ...DEFAULT_MESSAGE_TEMPLATES])];
    } catch {
      return [...DEFAULT_MESSAGE_TEMPLATES];
    }
  });
  const [templateText, setTemplateText] = useState(DEFAULT_MESSAGE_TEMPLATES[0]);
  const [selectedTemplateBase, setSelectedTemplateBase] = useState(DEFAULT_MESSAGE_TEMPLATES[0]);
  const [newTemplateDraft, setNewTemplateDraft] = useState("");
  const [templateClientId, setTemplateClientId] = useState<number | null>(null);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isTemplateManagerModalOpen, setIsTemplateManagerModalOpen] = useState(false);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const templateDraftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [simClientId, setSimClientId] = useState<number | null>(null);
  const [isSimulationModalOpen, setIsSimulationModalOpen] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isHeatBadgeMenuOpen, setIsHeatBadgeMenuOpen] = useState(false);
  const [isLostReasonModalOpen, setIsLostReasonModalOpen] = useState(false);
  const [lostReasonText, setLostReasonText] = useState("");
  const [isSummaryEditing, setIsSummaryEditing] = useState(false);
  const [summaryOverrides, setSummaryOverrides] = useState<Record<number, { simulation: string; product: string }>>(() => {
    try {
      const raw = localStorage.getItem("loan:summary-overrides");
      if (!raw) return {};
      return JSON.parse(raw) as Record<number, { simulation: string; product: string }>;
    } catch {
      return {};
    }
  });
  const [whatsMenuClientId, setWhatsMenuClientId] = useState<number | null>(null);
  const [clientSummaryForm, setClientSummaryForm] = useState({
    name: "",
    cpf: "",
    city: "",
    profession: "",
    convenio: "",
    income: "",
    status: "novo" as LoanClientStatus,
    marginAvailable: "",
    simulation: "",
    product: "",
    source: "",
    phones: "",
  });
  const [loadingAgendaCompleteId, setLoadingAgendaCompleteId] = useState<number | null>(null);
  const [movingNextStageClientId, setMovingNextStageClientId] = useState<number | null>(null);
  const kanbanScrollRef = useRef<HTMLDivElement | null>(null);
  const isKanbanDraggingRef = useRef(false);
  const kanbanDragStartXRef = useRef(0);
  const kanbanStartScrollLeftRef = useRef(0);
  const [draggingClientId, setDraggingClientId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<LoanClientStatus | null>(null);
  const [recentlyMovedClientId, setRecentlyMovedClientId] = useState<number | null>(null);

  const [simForm, setSimForm] = useState({
    productId: "",
    productType: "credito" as LoanProductType,
    principal: "",
    installments: "",
    monthlyRate: "",
  });

  const [productForm, setProductForm] = useState({
    name: "",
    productType: "credito" as LoanProductType,
    defaultRate: "",
    minTerm: "",
    maxTerm: "",
    active: true,
  });

  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<string[][]>([]);
  const [importMap, setImportMap] = useState<ImportFieldMap>(emptyMap);
  const [importSource, setImportSource] = useState("portal_transparencia");
  const [importPreviewCount, setImportPreviewCount] = useState(0);
  const [leadImportProgress, setLeadImportProgress] = useState<{
    total: number;
    processed: number;
    imported: number;
    duplicates: number;
    running: boolean;
  } | null>(null);
  const [isCancellingLeadImport, setIsCancellingLeadImport] = useState(false);
  const leadImportCancelRef = useRef(false);
  const dashboardCacheRef = useRef(new Map<string, { expiresAt: number; data: LoanDashboardState }>());
  const agendaCacheRef = useRef(new Map<string, { expiresAt: number; data: LoanAgendaItem[] }>());
  const cadastroCacheRef = useRef(new Map<string, { expiresAt: number; data: LoanClientsListResponse }>());
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [isClientDetailsModalOpen, setIsClientDetailsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isServidoresModalOpen, setIsServidoresModalOpen] = useState(false);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [isImportandoServidores, setIsImportandoServidores] = useState(false);
  const [savedLeadSources, setSavedLeadSources] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LEAD_SOURCES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { items?: string[] };
      return Array.isArray(parsed.items)
        ? parsed.items.map((item) => String(item).trim()).filter(Boolean).slice(0, 30)
        : [];
    } catch {
      return [];
    }
  });
  const [savedConvenios, setSavedConvenios] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(CONVENIOS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { items?: string[] };
      return Array.isArray(parsed.items)
        ? parsed.items.map((item) => String(item).trim()).filter(Boolean).slice(0, 30)
        : [];
    } catch {
      return [];
    }
  });
  const [servidoresForm, setServidoresForm] = useState({
    nome: "",
    ano: new Date().getFullYear(),
    mes: new Date().getMonth() + 1,
    tamanho: 50,
    maxPaginas: 10,
  });
  const [servidoresResultado, setServidoresResultado] = useState<{
    importados: number;
    comConsignado: number;
    semConsignado: number;
    duplicados: number;
    erros: number;
  } | null>(null);
  const [servidoresImportJob, setServidoresImportJob] = useState<{
    jobId: string;
    status: "running" | "completed" | "failed";
    processados: number;
    estimadoTotal: number;
    importados: number;
    duplicados: number;
    erros: number;
    errorMessage?: string;
  } | null>(null);
  const [servidoresImportados, setServidoresImportados] = useState<ImportedServant[]>([]);
  const [servidoresExpandidos, setServidoresExpandidos] = useState<number[]>([]);
  const [rubricasDescontoOptions, setRubricasDescontoOptions] = useState<
    Array<{ nome: string; total: number }>
  >([]);
  const [rubricaDropdownOpen, setRubricaDropdownOpen] = useState(false);
  const [servidoresLoading, setServidoresLoading] = useState(false);
  const [servidoresPaginacao, setServidoresPaginacao] = useState({
    page: 1,
    pageSize: (() => {
      try {
        const raw = localStorage.getItem(SERVIDORES_FILTERS_STORAGE_KEY);
        if (!raw) return 10;
        const parsed = JSON.parse(raw) as { pageSize?: number };
        return [10, 25, 50, 100, 200].includes(parsed.pageSize ?? 0) ? (parsed.pageSize as number) : 10;
      } catch {
        return 10;
      }
    })(),
    total: 0,
    totalPages: 1,
  });
  const [cadastroClientes, setCadastroClientes] = useState<LoanClient[]>([]);
  const [cadastroFiltro, setCadastroFiltro] = useState(() => {
    try {
      const raw = localStorage.getItem(CADASTRO_FILTERS_STORAGE_KEY);
      if (!raw) {
        return {
          busca: "",
          cpf: "",
          city: "",
          profession: "",
          convenio: "",
          status: "",
          vendedorId: "",
          sortBy: "updatedAt" as CadastroSortBy,
          sortDir: "desc" as SortDir,
        };
      }
      const parsed = JSON.parse(raw) as {
        busca?: string;
        cpf?: string;
        city?: string;
        profession?: string;
        convenio?: string;
        status?: string;
        vendedorId?: string;
        sortBy?: string;
        sortDir?: string;
      };
      const sortBy: CadastroSortBy =
        parsed.sortBy === "name" ||
        parsed.sortBy === "cpf" ||
        parsed.sortBy === "city" ||
        parsed.sortBy === "profession" ||
        parsed.sortBy === "convenio" ||
        parsed.sortBy === "assignedUserName" ||
        parsed.sortBy === "status" ||
        parsed.sortBy === "updatedAt"
          ? parsed.sortBy
          : "updatedAt";
      const sortDir: SortDir = parsed.sortDir === "asc" || parsed.sortDir === "desc" ? parsed.sortDir : "desc";
      return {
        busca: typeof parsed.busca === "string" ? parsed.busca : "",
        cpf: typeof parsed.cpf === "string" ? parsed.cpf : "",
        city: typeof parsed.city === "string" ? parsed.city : "",
        profession: typeof parsed.profession === "string" ? parsed.profession : "",
        convenio: typeof parsed.convenio === "string" ? parsed.convenio : "",
        status: typeof parsed.status === "string" ? parsed.status : "",
        vendedorId: typeof parsed.vendedorId === "string" ? parsed.vendedorId : "",
        sortBy,
        sortDir,
      };
    } catch {
      return {
        busca: "",
        cpf: "",
        city: "",
        profession: "",
        convenio: "",
        status: "",
        vendedorId: "",
        sortBy: "updatedAt" as CadastroSortBy,
        sortDir: "desc" as SortDir,
      };
    }
  });
  const [cadastroPaginacao, setCadastroPaginacao] = useState({
    page: 1,
    pageSize: (() => {
      try {
        const raw = localStorage.getItem(CADASTRO_FILTERS_STORAGE_KEY);
        if (!raw) return 10;
        const parsed = JSON.parse(raw) as { pageSize?: number };
        return [10, 25, 50, 100, 200].includes(parsed.pageSize ?? 0) ? (parsed.pageSize as number) : 10;
      } catch {
        return 10;
      }
    })(),
    total: 0,
    totalPages: 1,
  });
  const [consignableMarginPercent, setConsignableMarginPercent] = useState("30");
  const [consignadoRate, setConsignadoRate] = useState("1.8");
  const [pessoalRate, setPessoalRate] = useState("3.5");
  const [isSavingLoanSettings, setIsSavingLoanSettings] = useState(false);
  const [simulandoServidorId, setSimulandoServidorId] = useState<number | null>(null);
  const [simulacoesRecentesIds, setSimulacoesRecentesIds] = useState<number[]>([]);
  const [clientesPaginacao, setClientesPaginacao] = useState({
    page: 1,
    pageSize: (() => {
      try {
        const raw = localStorage.getItem(KANBAN_FILTERS_STORAGE_KEY);
        if (!raw) return 10;
        const parsed = JSON.parse(raw) as { pageSize?: number };
        return [10, 25, 50, 100, 200].includes(parsed.pageSize ?? 0) ? (parsed.pageSize as number) : 10;
      } catch {
        return 10;
      }
    })(),
    total: 0,
    totalPages: 1,
  });
  const [kanbanColumnTotals, setKanbanColumnTotals] = useState<Record<LoanClientStatus, number>>(EMPTY_KANBAN_TOTALS);
  const [kanbanCardsByStatus, setKanbanCardsByStatus] = useState<Record<LoanClientStatus, LoanClient[]>>(
    EMPTY_KANBAN_CARDS,
  );
  const [clientesFiltro, setClientesFiltro] = useState(() => {
    try {
      const raw = localStorage.getItem(KANBAN_FILTERS_STORAGE_KEY);
      if (!raw) return { busca: "", status: "", vendedorId: String(user?.id ?? ""), monthRef: "" };
      const parsed = JSON.parse(raw) as { busca?: string; status?: string; vendedorId?: string; monthRef?: string };
      return {
        busca: typeof parsed.busca === "string" ? parsed.busca : "",
        status: typeof parsed.status === "string" ? parsed.status : "",
        vendedorId:
          typeof parsed.vendedorId === "string"
            ? parsed.vendedorId
            : String(user?.id ?? ""),
        monthRef: typeof parsed.monthRef === "string" ? parsed.monthRef : "",
      };
    } catch {
      return { busca: "", status: "", vendedorId: String(user?.id ?? ""), monthRef: "" };
    }
  });
  const [servidoresFiltro, setServidoresFiltro] = useState(() => {
    try {
      const raw = localStorage.getItem(SERVIDORES_FILTERS_STORAGE_KEY);
      if (!raw) {
        return {
          nome: "",
          rubrica: "",
          ano: "",
          mes: "",
          classificacao: "",
          classificacaoMargem: "",
          classificacaoScore: "",
          prioridadeAtendimento: "",
        };
      }
      const parsed = JSON.parse(raw) as {
        nome?: string;
        rubrica?: string;
        ano?: string;
        mes?: string;
        classificacao?: string;
        classificacaoMargem?: string;
        classificacaoScore?: string;
        prioridadeAtendimento?: string;
      };
      return {
        nome: typeof parsed.nome === "string" ? parsed.nome : "",
        rubrica: typeof parsed.rubrica === "string" ? parsed.rubrica : "",
        ano: typeof parsed.ano === "string" ? parsed.ano : "",
        mes: typeof parsed.mes === "string" ? parsed.mes : "",
        classificacao: typeof parsed.classificacao === "string" ? parsed.classificacao : "",
        classificacaoMargem:
          typeof parsed.classificacaoMargem === "string" ? parsed.classificacaoMargem : "",
        classificacaoScore: typeof parsed.classificacaoScore === "string" ? parsed.classificacaoScore : "",
        prioridadeAtendimento:
          typeof parsed.prioridadeAtendimento === "string" ? parsed.prioridadeAtendimento : "",
      };
    } catch {
      return {
        nome: "",
        rubrica: "",
        ano: "",
        mes: "",
        classificacao: "",
        classificacaoMargem: "",
        classificacaoScore: "",
        prioridadeAtendimento: "",
      };
    }
  });

  const servidoresQuery = useMemo(() => {
    const ano = Number(servidoresFiltro.ano);
    const mes = Number(servidoresFiltro.mes);
    const classificacaoNormalizada: "Com consignado" | "Sem consignado" | undefined =
      servidoresFiltro.classificacao === "Com consignado" ||
      servidoresFiltro.classificacao === "Sem consignado"
        ? servidoresFiltro.classificacao
        : undefined;
    const classificacaoMargemNormalizada: "Alta" | "Media" | "Baixa" | undefined =
      servidoresFiltro.classificacaoMargem === "Alta" ||
      servidoresFiltro.classificacaoMargem === "Media" ||
      servidoresFiltro.classificacaoMargem === "Baixa"
        ? servidoresFiltro.classificacaoMargem
        : undefined;
    const classificacaoScoreNormalizada: "Quente" | "Morno" | "Frio" | undefined =
      servidoresFiltro.classificacaoScore === "Quente" ||
      servidoresFiltro.classificacaoScore === "Morno" ||
      servidoresFiltro.classificacaoScore === "Frio"
        ? servidoresFiltro.classificacaoScore
        : undefined;
    const prioridadeAtendimentoNormalizada: "Alta" | "Media" | "Baixa" | undefined =
      servidoresFiltro.prioridadeAtendimento === "Alta" ||
      servidoresFiltro.prioridadeAtendimento === "Media" ||
      servidoresFiltro.prioridadeAtendimento === "Baixa"
        ? servidoresFiltro.prioridadeAtendimento
        : undefined;
    return {
      nome: servidoresFiltro.nome.trim() || undefined,
      rubrica: servidoresFiltro.rubrica.trim() || undefined,
      ano: Number.isFinite(ano) && ano > 0 ? ano : undefined,
      mes: Number.isFinite(mes) && mes > 0 ? mes : undefined,
      classificacao: classificacaoNormalizada,
      classificacaoMargem: classificacaoMargemNormalizada,
      classificacaoScore: classificacaoScoreNormalizada,
      prioridadeAtendimento: prioridadeAtendimentoNormalizada,
      page: servidoresPaginacao.page,
      limit: servidoresPaginacao.pageSize,
    };
  }, [servidoresFiltro, servidoresPaginacao.page, servidoresPaginacao.pageSize]);
  const [debouncedKanbanSearch, setDebouncedKanbanSearch] = useState(clientesFiltro.busca);
  const [debouncedCadastroSearch, setDebouncedCadastroSearch] = useState(cadastroFiltro.busca);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKanbanSearch(clientesFiltro.busca);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [clientesFiltro.busca]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedCadastroSearch(cadastroFiltro.busca);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [cadastroFiltro.busca]);
  const clientesQuery = useMemo(
    () => {
      const statusNormalizado = statusFlow.some((item) => item.key === clientesFiltro.status)
        ? (clientesFiltro.status as LoanClientStatus)
        : undefined;
      return {
        search: debouncedKanbanSearch.trim() || undefined,
        monthRef: /^\d{4}-\d{2}$/.test(clientesFiltro.monthRef) ? clientesFiltro.monthRef : undefined,
        status: statusNormalizado,
        assignedUserId: Number(clientesFiltro.vendedorId) || undefined,
        page: clientesPaginacao.page,
        limit: clientesPaginacao.pageSize,
      };
    },
    [
      debouncedKanbanSearch,
      clientesFiltro.monthRef,
      clientesFiltro.status,
      clientesFiltro.vendedorId,
      clientesPaginacao.page,
      clientesPaginacao.pageSize,
    ],
  );
  const monthFilterOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [{ value: "", label: "Todos os meses" }];
    const now = new Date();
    for (let i = 0; i < 24; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      options.push({ value, label: monthRefLabel(value) });
    }
    return options;
  }, []);
  const agendaCalendarEvents = useMemo(
    () =>
      agendaItems.map((item) => {
        const start = new Date(item.scheduledFor);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        return {
          title: `${item.clientName} - ${item.completedAt ? "Concluído" : "Pendente"}`,
          start,
          end,
          allDay: false,
          resource: item,
        };
      }),
    [agendaItems],
  );
  const quickAgendaClients = useMemo(() => {
    const map = new Map<number, LoanClient>();
    for (const client of clients) map.set(client.id, client);
    for (const client of cadastroClientes) map.set(client.id, client);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [clients, cadastroClientes]);
  const cadastroQuery = useMemo(
    () => {
      const statusNormalizado = statusFlow.some((item) => item.key === cadastroFiltro.status)
        ? (cadastroFiltro.status as LoanClientStatus)
        : undefined;
      return {
        search: debouncedCadastroSearch.trim() || undefined,
        assignedUserId: Number(cadastroFiltro.vendedorId) || undefined,
        status: statusNormalizado,
        sortBy: cadastroFiltro.sortBy,
        sortDir: cadastroFiltro.sortDir,
        page: cadastroPaginacao.page,
        limit: cadastroPaginacao.pageSize,
      };
    },
    [
      debouncedCadastroSearch,
      cadastroFiltro.vendedorId,
      cadastroFiltro.status,
      cadastroFiltro.sortBy,
      cadastroFiltro.sortDir,
      cadastroPaginacao.page,
      cadastroPaginacao.pageSize,
    ],
  );
  const filteredCadastroClientes = useMemo(() => {
    const cpfTerm = cadastroFiltro.cpf.trim().toLowerCase();
    const cityTerm = cadastroFiltro.city.trim().toLowerCase();
    const professionTerm = cadastroFiltro.profession.trim().toLowerCase();
    const convenioTerm = cadastroFiltro.convenio.trim().toLowerCase();
    return cadastroClientes.filter((client) => {
      const matchesCpf = !cpfTerm || client.cpf.toLowerCase().includes(cpfTerm);
      const matchesCity = !cityTerm || client.city.toLowerCase().includes(cityTerm);
      const matchesProfession = !professionTerm || client.profession.toLowerCase().includes(professionTerm);
      const matchesConvenio = !convenioTerm || client.convenio.toLowerCase().includes(convenioTerm);
      return matchesCpf && matchesCity && matchesProfession && matchesConvenio;
    });
  }, [cadastroClientes, cadastroFiltro.cpf, cadastroFiltro.city, cadastroFiltro.profession, cadastroFiltro.convenio]);

  const selectedClient = useMemo(
    () => clients.find((item) => item.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );
  const templateClient = useMemo(
    () => clients.find((item) => item.id === templateClientId) ?? null,
    [clients, templateClientId],
  );
  const applyTemplateTags = (template: string, client: LoanClient): string => {
    const statusLabel = statusFlow.find((item) => item.key === client.status)?.label ?? client.status;
    const margemDisponivel = (Number(client.income || 0) * Number(consignableMarginPercent || "30")) / 100;
    const nomeCompleto = (client.name || "").trim();
    const primeiroNome = nomeCompleto.split(/\s+/).filter(Boolean)[0] ?? "";
    const tagMap: Record<string, string> = {
      "{saudacao}": getSaudacao(),
      "{primeiro_nome}": primeiroNome,
      "{nome_completo}": nomeCompleto,
      "{nome}": nomeCompleto,
      "{telefone}": formatPhonesDisplay(client.phones, "Sem telefone"),
      "{cpf}": client.cpf || "",
      "{cidade}": client.city || "",
      "{profissao}": client.profession || "",
      "{convenio}": client.convenio || "",
      "{renda}": formatCurrency(Number(client.income || 0)),
      "{status}": statusLabel,
      "{origem}": client.source || "",
      "{vendedor}": client.assignedUserName || "Sem vendedor",
      "{margem}": formatCurrency(Math.max(0, margemDisponivel)),
    };
    return Object.entries(tagMap).reduce(
      (acc, [tag, value]) => acc.replace(new RegExp(tag.replace(/[{}]/g, "\\$&"), "gi"), value),
      template,
    );
  };
  const simClient = useMemo(
    () => clients.find((item) => item.id === simClientId) ?? null,
    [clients, simClientId],
  );
  const templateManagerPreviewText = useMemo(() => {
    if (!templateClient) return newTemplateDraft.trim();
    const source = newTemplateDraft.trim() || selectedTemplateBase || DEFAULT_MESSAGE_TEMPLATES[0];
    return applyTemplateTags(source, templateClient);
  }, [templateClient, newTemplateDraft, selectedTemplateBase]);
  const selectedClientSummaryOverride = useMemo(
    () => (selectedClient ? summaryOverrides[selectedClient.id] : undefined),
    [selectedClient, summaryOverrides],
  );
  useEffect(() => {
    if (!selectedClient) return;
    const override = summaryOverrides[selectedClient.id];
    const marginValue = (Number(selectedClient.income || 0) * Number(consignableMarginPercent || "30")) / 100;
    const monthlyRate = Number(consignadoRate || "1.8") / 100;
    const terms = [36, 48, 60, 72];
    let bestInstallments = 0;
    let bestPrincipal = 0;
    for (const installments of terms) {
      const principal =
        monthlyRate > 0
          ? marginValue * ((1 - (1 + monthlyRate) ** -installments) / monthlyRate)
          : marginValue * installments;
      if (principal > bestPrincipal) {
        bestPrincipal = principal;
        bestInstallments = installments;
      }
    }
    const defaultProduct =
      marginValue <= 0
        ? "Sem margem"
        : (selectedClient.convenio?.trim() ? "Com consignado" : "Sem consignado") === "Sem consignado"
          ? "Primeiro consignado"
          : marginValue < 200
            ? "Refinanciamento"
            : "Crédito consignado";
    setClientSummaryForm({
      name: selectedClient.name || "",
      cpf: selectedClient.cpf || "",
      city: selectedClient.city || "",
      profession: selectedClient.profession || "",
      convenio: selectedClient.convenio || "",
      income: String(Number(selectedClient.income || 0)),
      status: selectedClient.status,
      marginAvailable: String(Number.isFinite(marginValue) ? marginValue : 0),
      simulation:
        override?.simulation ??
        (bestInstallments > 0
          ? `${bestInstallments}x de ${marginValue.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}`
          : "Sem simulação"),
      product: override?.product ?? defaultProduct,
      source: selectedClient.source || "",
      phones: selectedClient.phones.join(", "),
    });
    setIsHeatBadgeMenuOpen(false);
    setIsSummaryEditing(false);
  }, [selectedClient, summaryOverrides, consignableMarginPercent, consignadoRate]);
  useEffect(() => {
    try {
      localStorage.setItem("loan:summary-overrides", JSON.stringify(summaryOverrides));
    } catch {
      // Ignora falha de storage.
    }
  }, [summaryOverrides]);
  useEffect(() => {
    try {
      localStorage.setItem("loan:agenda-view", agendaViewMode);
    } catch {
      // Ignora falha de storage.
    }
  }, [agendaViewMode]);
  useEffect(() => {
    try {
      localStorage.setItem(
        TEMPLATE_LIBRARY_STORAGE_KEY,
        JSON.stringify({
          items: templateLibrary,
        }),
      );
    } catch {
      // Ignora falha de storage sem bloquear o fluxo.
    }
  }, [templateLibrary]);
  const rubricaBuscaTermo = servidoresFiltro.rubrica.trim().toUpperCase();
  const novosLeadsTotal = useMemo(
    () => dashboard?.statusBreakdown.find((item) => item.status === "novo")?.total ?? 0,
    [dashboard],
  );
  const rubricasDescontoFiltradas = useMemo(() => {
    if (!rubricaBuscaTermo) return rubricasDescontoOptions.slice(0, 60);
    return rubricasDescontoOptions
      .filter((item) => item.nome.includes(rubricaBuscaTermo))
      .slice(0, 60);
  }, [rubricasDescontoOptions, rubricaBuscaTermo]);
  const sourceOptions = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const pushOption = (value: string) => {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      ordered.push(normalized);
    };
    for (const source of savedLeadSources) pushOption(source);
    pushOption("manual");
    pushOption("portal_transparencia");
    for (const item of clients) {
      pushOption(item.source ?? "");
    }
    for (const item of cadastroClientes) {
      pushOption(item.source ?? "");
    }
    pushOption(clientForm.source);
    return ordered;
  }, [savedLeadSources, clients, cadastroClientes, clientForm.source]);
  const convenioOptions = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const pushOption = (value: string) => {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      ordered.push(normalized);
    };
    for (const convenio of savedConvenios) pushOption(convenio);
    pushOption("INSS");
    for (const item of clients) {
      pushOption(item.convenio ?? "");
    }
    for (const item of cadastroClientes) {
      pushOption(item.convenio ?? "");
    }
    pushOption(clientForm.convenio);
    return ordered;
  }, [savedConvenios, clients, cadastroClientes, clientForm.convenio]);

  async function loadMainData(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent ?? true;
    const cacheKey = JSON.stringify({
      monthRef: /^\d{4}-\d{2}$/.test(clientesFiltro.monthRef) ? clientesFiltro.monthRef : "",
    });
    const cached = dashboardCacheRef.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setDashboard(cached.data);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const dashboardData = await getLoanDashboard({
        monthRef: /^\d{4}-\d{2}$/.test(clientesFiltro.monthRef) ? clientesFiltro.monthRef : undefined,
      });
      setDashboard(dashboardData);
      dashboardCacheRef.current.set(cacheKey, {
        expiresAt: Date.now() + LOAN_VIEW_CACHE_TTL_MS,
        data: dashboardData,
      });
    } catch {
      setMessage("Falha ao carregar dados de empréstimos.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function invalidateLoanViewCaches(): void {
    dashboardCacheRef.current.clear();
    agendaCacheRef.current.clear();
    cadastroCacheRef.current.clear();
  }

  async function loadProductsData(): Promise<void> {
    try {
      setProducts(await listLoanProducts());
    } catch {
      setMessage("Falha ao carregar produtos.");
    }
  }

  async function loadSellerOptions(): Promise<void> {
    try {
      const data = await listLoanSellers();
      setSellerOptions(data);
      if (data.length > 0) {
        setClientForm((prev) => {
          if (prev.assignedUserId && data.some((seller) => seller.id === prev.assignedUserId)) {
            return prev;
          }
          const fallback = user?.id && data.some((seller) => seller.id === user.id) ? user.id : data[0].id;
          const fallbackName = data.find((seller) => seller.id === fallback)?.name ?? "";
          return {
            ...prev,
            assignedUserId: fallback,
            assignedUserName: fallbackName,
          };
        });
      }
    } catch {
      setMessage("Falha ao carregar vendedores.");
    }
  }

  async function loadLoanSettings(): Promise<void> {
    try {
      const data = await getLoanSettings();
      setConsignableMarginPercent(String(data.consignableMarginPercent));
      setConsignadoRate(String(data.consignadoRate));
      setPessoalRate(String(data.pessoalRate));
    } catch {
      setMessage("Falha ao carregar configuração de margem.");
    }
  }

  async function loadClientsData(): Promise<void> {
    try {
      if (clientesQuery.status) {
        const response = await listLoanClients({
          search: clientesQuery.search,
          monthRef: clientesQuery.monthRef,
          status: clientesQuery.status,
          assignedUserId: clientesQuery.assignedUserId,
          page: clientesQuery.page,
          limit: clientesQuery.limit,
        });
        setClients(response.items);
        const byStatus: Record<LoanClientStatus, LoanClient[]> = { ...EMPTY_KANBAN_CARDS };
        byStatus[clientesQuery.status] = response.items;
        setKanbanCardsByStatus(byStatus);
        setClientesPaginacao((prev) => ({
          ...prev,
          page: response.page,
          pageSize: response.pageSize,
          total: response.total,
          totalPages: response.totalPages,
        }));
        const totalsByStatus: Record<LoanClientStatus, number> = { ...EMPTY_KANBAN_TOTALS };
        totalsByStatus[clientesQuery.status] = response.total;
        setKanbanColumnTotals(totalsByStatus);
        setSelectedClientId((prev) =>
          response.items.some((item) => item.id === prev) ? prev : (response.items[0]?.id ?? null),
        );
      } else {
        const responsesByStatus = await Promise.all(
          statusFlow.map(async (column) => {
            try {
              const result = await listLoanClients({
                search: clientesQuery.search,
              monthRef: clientesQuery.monthRef,
                status: column.key,
                assignedUserId: clientesQuery.assignedUserId,
                page: 1,
                limit: clientesQuery.limit,
              });
              return [column.key, result] as const;
            } catch {
              return [
                column.key,
                { items: [], total: 0, page: 1, pageSize: clientesQuery.limit ?? 10, totalPages: 1 },
              ] as const;
            }
          }),
        );
        const totals = Object.fromEntries(
          responsesByStatus.map(([status, result]) => [status, result.total]),
        ) as Record<LoanClientStatus, number>;
        const cardsByStatus = Object.fromEntries(
          responsesByStatus.map(([status, result]) => [status, result.items]),
        ) as Record<LoanClientStatus, LoanClient[]>;
        const flattened = statusFlow.flatMap((column) => cardsByStatus[column.key] ?? []);
        const deduped = Array.from(new Map(flattened.map((item) => [item.id, item])).values());
        const total = statusFlow.reduce((acc, column) => acc + (totals[column.key] ?? 0), 0);
        setClients(deduped);
        setKanbanCardsByStatus(cardsByStatus);
        setClientesPaginacao((prev) => ({
          ...prev,
          page: 1,
          pageSize: clientesQuery.limit ?? prev.pageSize,
          total,
          totalPages: 1,
        }));
        setKanbanColumnTotals(totals);
        setSelectedClientId((prev) => (deduped.some((item) => item.id === prev) ? prev : (deduped[0]?.id ?? null)));
      }
    } catch {
      setMessage("Falha ao carregar clientes.");
    }
  }

  async function loadCadastroData(): Promise<void> {
    const cacheKey = JSON.stringify(cadastroQuery);
    const cached = cadastroCacheRef.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setCadastroClientes(cached.data.items);
      setCadastroPaginacao((prev) => ({
        ...prev,
        page: cached.data.page,
        pageSize: cached.data.pageSize,
        total: cached.data.total,
        totalPages: cached.data.totalPages,
      }));
      return;
    }
    try {
      const response = await listLoanClients({
        search: cadastroQuery.search,
        assignedUserId: cadastroQuery.assignedUserId,
        status: cadastroQuery.status,
        sortBy: cadastroQuery.sortBy,
        sortDir: cadastroQuery.sortDir,
        page: cadastroQuery.page,
        limit: cadastroQuery.limit,
      });
      setCadastroClientes(response.items);
      setCadastroPaginacao((prev) => ({
        ...prev,
        page: response.page,
        pageSize: response.pageSize,
        total: response.total,
        totalPages: response.totalPages,
      }));
      cadastroCacheRef.current.set(cacheKey, {
        expiresAt: Date.now() + LOAN_VIEW_CACHE_TTL_MS,
        data: response,
      });
    } catch {
      setMessage("Falha ao carregar cadastro de clientes.");
    }
  }

  async function loadClientDetails(clientId: number): Promise<void> {
    try {
      const [interactionsData, simulationsData] = await Promise.all([
        listLoanInteractions(clientId),
        listLoanSimulations(clientId),
      ]);
      setInteractions(interactionsData);
      setSimulations(simulationsData);
    } catch {
      setMessage("Falha ao carregar detalhes do cliente.");
    }
  }

  async function loadAgendaData(): Promise<void> {
    const cacheKey = JSON.stringify({
      monthRef: /^\d{4}-\d{2}$/.test(clientesFiltro.monthRef) ? clientesFiltro.monthRef : "",
      status: agendaStatusFilter,
    });
    const cached = agendaCacheRef.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setAgendaItems(cached.data);
      return;
    }
    try {
      const data = await listLoanAgenda({
        monthRef: /^\d{4}-\d{2}$/.test(clientesFiltro.monthRef) ? clientesFiltro.monthRef : undefined,
        status: agendaStatusFilter,
      });
      setAgendaItems(data);
      agendaCacheRef.current.set(cacheKey, {
        expiresAt: Date.now() + LOAN_VIEW_CACHE_TTL_MS,
        data,
      });
    } catch {
      setMessage("Falha ao carregar agenda.");
    }
  }

  async function loadServidoresData(): Promise<void> {
    setServidoresLoading(true);
    try {
      const data = await listServidoresImportados(servidoresQuery);
      setServidoresImportados(data.items);
      setServidoresPaginacao((prev) => ({
        ...prev,
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        totalPages: data.totalPages,
      }));
    } catch {
      setMessage("Falha ao filtrar servidores importados.");
    } finally {
      setServidoresLoading(false);
    }
  }

  async function loadRubricasDescontoOptions(): Promise<void> {
    try {
      const data = await listRubricasDescontoServidores();
      setRubricasDescontoOptions(data);
    } catch {
      // Mantém a página funcional mesmo se falhar o carregamento das rubricas.
      setRubricasDescontoOptions([]);
    }
  }

  async function refreshVisibleLoanData(options?: { includeAgenda?: boolean; includeCadastro?: boolean }): Promise<void> {
    const tasks: Array<Promise<void>> = [loadMainData()];
    const shouldLoadFunil = loanSection === "funil" || isClientDetailsModalOpen;
    const shouldLoadCadastro = loanSection === "cadastro" || Boolean(options?.includeCadastro);
    const shouldLoadAgenda = loanSection === "agenda" || Boolean(options?.includeAgenda);
    if (shouldLoadFunil) tasks.push(loadClientsData());
    if (shouldLoadCadastro) tasks.push(loadCadastroData());
    if (shouldLoadAgenda) tasks.push(loadAgendaData());
    await Promise.all(tasks);
  }

  useEffect(() => {
    void loadProductsData();
    void loadMainData({ silent: false });
    void loadRubricasDescontoOptions();
    void loadSellerOptions();
    if (isAdmin) {
      void loadLoanSettings();
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    void loadClientsData();
  }, [clientesQuery, loading]);

  useEffect(() => {
    if (loading) return;
    void loadMainData();
  }, [clientesFiltro.monthRef]);

  useEffect(() => {
    if (loading || loanSection !== "agenda") return;
    void loadAgendaData();
  }, [loanSection, clientesFiltro.monthRef, agendaStatusFilter, loading]);

  useEffect(() => {
    if (loading) return;
    void loadCadastroData();
  }, [cadastroQuery, loading]);

  useEffect(() => {
    try {
      localStorage.setItem(
        KANBAN_FILTERS_STORAGE_KEY,
        JSON.stringify({
          busca: clientesFiltro.busca,
          monthRef: clientesFiltro.monthRef,
          status: clientesFiltro.status,
          vendedorId: clientesFiltro.vendedorId,
          pageSize: clientesPaginacao.pageSize,
        }),
      );
    } catch {
      // Ignora falha de storage no navegador.
    }
  }, [
    clientesFiltro.busca,
    clientesFiltro.monthRef,
    clientesFiltro.status,
    clientesFiltro.vendedorId,
    clientesPaginacao.pageSize,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CADASTRO_FILTERS_STORAGE_KEY,
        JSON.stringify({
          busca: cadastroFiltro.busca,
          cpf: cadastroFiltro.cpf,
          city: cadastroFiltro.city,
          profession: cadastroFiltro.profession,
          convenio: cadastroFiltro.convenio,
          status: cadastroFiltro.status,
          vendedorId: cadastroFiltro.vendedorId,
          sortBy: cadastroFiltro.sortBy,
          sortDir: cadastroFiltro.sortDir,
          pageSize: cadastroPaginacao.pageSize,
        }),
      );
    } catch {
      // Ignora falha de storage no navegador.
    }
  }, [
    cadastroFiltro.busca,
    cadastroFiltro.cpf,
    cadastroFiltro.city,
    cadastroFiltro.profession,
    cadastroFiltro.convenio,
    cadastroFiltro.status,
    cadastroFiltro.vendedorId,
    cadastroFiltro.sortBy,
    cadastroFiltro.sortDir,
    cadastroPaginacao.pageSize,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LEAD_SOURCES_STORAGE_KEY,
        JSON.stringify({
          items: savedLeadSources,
        }),
      );
    } catch {
      // Ignora falha de storage no navegador.
    }
  }, [savedLeadSources]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CONVENIOS_STORAGE_KEY,
        JSON.stringify({
          items: savedConvenios,
        }),
      );
    } catch {
      // Ignora falha de storage no navegador.
    }
  }, [savedConvenios]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SERVIDORES_FILTERS_STORAGE_KEY,
        JSON.stringify({
          nome: servidoresFiltro.nome,
          rubrica: servidoresFiltro.rubrica,
          ano: servidoresFiltro.ano,
          mes: servidoresFiltro.mes,
          classificacao: servidoresFiltro.classificacao,
          pageSize: servidoresPaginacao.pageSize,
          classificacaoMargem: servidoresFiltro.classificacaoMargem,
          classificacaoScore: servidoresFiltro.classificacaoScore,
          prioridadeAtendimento: servidoresFiltro.prioridadeAtendimento,
        }),
      );
    } catch {
      // Ignora falha de storage no navegador.
    }
  }, [
    servidoresFiltro.nome,
    servidoresFiltro.rubrica,
    servidoresFiltro.ano,
    servidoresFiltro.mes,
    servidoresFiltro.classificacao,
    servidoresFiltro.classificacaoMargem,
    servidoresFiltro.classificacaoScore,
    servidoresFiltro.prioridadeAtendimento,
    servidoresPaginacao.pageSize,
  ]);

  useEffect(() => {
    if (!selectedClientId) {
      setInteractions([]);
      setSimulations([]);
      setInteractionScheduledFor("");
      return;
    }
    setInteractions([]);
    setSimulations([]);
    setInteractionScheduledFor("");
    void loadClientDetails(selectedClientId);
  }, [selectedClientId]);

  useEffect(() => {
    if (whatsMenuClientId === null) return;
    const onWindowClick = () => setWhatsMenuClientId(null);
    window.addEventListener("click", onWindowClick);
    return () => window.removeEventListener("click", onWindowClick);
  }, [whatsMenuClientId]);

  useEffect(() => {
    if (loading) return;
    void loadServidoresData();
  }, [servidoresQuery, loading]);

  useEffect(() => {
    if (!servidoresImportJob || servidoresImportJob.status !== "running") return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const progress = await getProgressoImportacaoServidores(servidoresImportJob.jobId);
          setServidoresImportJob(progress);
          if (progress.status === "completed") {
            setServidoresResultado({
              importados: progress.importados,
              comConsignado: progress.comConsignado,
              semConsignado: progress.semConsignado,
              duplicados: progress.duplicados,
              erros: progress.erros,
            });
            setMessage(
              `${progress.importados} servidores importados | ${progress.comConsignado} com consignado | ${progress.semConsignado} sem consignado`,
            );
            await loadMainData();
            await loadRubricasDescontoOptions();
          } else if (progress.status === "failed") {
            setMessage(progress.errorMessage ?? "Falha ao importar servidores do Portal da Transparência.");
          }
        } catch {
          // polling resiliente: mantem tentando no proximo ciclo
        }
      })();
    }, 1000);
    return () => clearInterval(timer);
  }, [servidoresImportJob]);

  const onCreateClient = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    const payload = {
      name: clientForm.name,
      cpf: clientForm.cpf,
      phones: clientForm.phones
        .map((item) => item.trim())
        .filter(Boolean),
      city: clientForm.city,
      profession: clientForm.profession,
      convenio: clientForm.convenio,
      income: Number(clientForm.income || 0),
      heatBadge: clientForm.heatBadge,
      source: clientForm.source,
      status: clientForm.status,
      assignedUserId: clientForm.assignedUserId || undefined,
    };
    try {
      const currentEditingId = editingClientId;
      if (editingClientId) {
        await updateLoanClient(editingClientId, payload);
      } else {
        await createLoanClient(payload);
      }
      setClientForm({
        name: "",
        cpf: "",
        phones: [""],
        city: "",
        profession: "",
        convenio: "INSS",
        income: "",
        heatBadge: null,
        source: "manual",
        status: "novo",
        assignedUserId: user?.id ?? sellerOptions[0]?.id ?? 0,
        assignedUserName: user?.name ?? sellerOptions[0]?.name ?? "",
      });
      setEditingClientId(null);
      setIsClientModalOpen(false);
      setIsSellerModalOpen(false);
      invalidateLoanViewCaches();
      await refreshVisibleLoanData({ includeCadastro: true });
      if (currentEditingId && selectedClientId === currentEditingId) {
        const refreshedClient = await getLoanClientById(currentEditingId);
        setClients((current) =>
          current.some((item) => item.id === refreshedClient.id)
            ? current.map((item) => (item.id === refreshedClient.id ? refreshedClient : item))
            : [refreshedClient, ...current],
        );
      }
      setMessage(editingClientId ? "Cliente atualizado." : "Cliente cadastrado.");
    } catch {
      setMessage("Não foi possível salvar cliente. Verifique CPF/telefone.");
    }
  };

  const onEditarCliente = (client: LoanClient) => {
    setEditingClientId(client.id);
    setClientForm({
      name: client.name,
      cpf: formatCpf(client.cpf),
      phones: client.phones.length > 0 ? client.phones.map((item) => formatPhone(item)) : [""],
      city: client.city || "",
      profession: client.profession || "",
      convenio: client.convenio || "INSS",
      income: String(Number(client.income || 0)),
      heatBadge: client.heatBadge ?? null,
      source: client.source || "manual",
      status: client.status,
      assignedUserId: client.assignedUserId ?? user?.id ?? 0,
      assignedUserName: client.assignedUserName ?? user?.name ?? "",
    });
    setIsClientModalOpen(true);
  };

  const onExcluirClienteCadastro = async (client: LoanClient) => {
    if (!window.confirm(`Deseja excluir o cliente "${client.name}"?`)) return;
    try {
      await deleteLoanClient(client.id);
      invalidateLoanViewCaches();
      await refreshVisibleLoanData({ includeCadastro: true, includeAgenda: true });
      setMessage("Cliente excluído.");
    } catch {
      setMessage("Não foi possível excluir cliente.");
    }
  };

  const onAddLeadSourceOption = () => {
    const value = window.prompt("Informe a nova origem do lead:");
    const normalized = (value ?? "").trim();
    if (!normalized) return;
    setSavedLeadSources((current) =>
      [normalized, ...current.filter((item) => item !== normalized)].slice(0, 30),
    );
    setClientForm((prev) => ({ ...prev, source: normalized }));
    setMessage(`Origem "${normalized}" salva na lista.`);
  };

  const onAddConvenioOption = () => {
    const value = window.prompt("Informe o novo convênio:");
    const normalized = (value ?? "").trim();
    if (!normalized) return;
    setSavedConvenios((current) =>
      [normalized, ...current.filter((item) => item !== normalized)].slice(0, 30),
    );
    setClientForm((prev) => ({ ...prev, convenio: normalized }));
    setMessage(`Convênio "${normalized}" salvo na lista.`);
  };

  const onStatusChange = async (clientId: number, status: LoanClientStatus) => {
    const previous = clients;
    const previousByStatus = kanbanCardsByStatus;
    setClients((current) => current.map((item) => (item.id === clientId ? { ...item, status } : item)));
    setKanbanCardsByStatus((current) => {
      const moving = statusFlow
        .flatMap((column) => current[column.key] ?? [])
        .find((item) => item.id === clientId);
      if (!moving || moving.status === status) return current;
      const next = Object.fromEntries(
        statusFlow.map((column) => [column.key, (current[column.key] ?? []).filter((item) => item.id !== clientId)]),
      ) as Record<LoanClientStatus, LoanClient[]>;
      next[status] = [...next[status], { ...moving, status }];
      return next;
    });
    try {
      await updateLoanClientStatus(clientId, status);
      invalidateLoanViewCaches();
      await refreshVisibleLoanData();
      setRecentlyMovedClientId(clientId);
      window.setTimeout(() => {
        setRecentlyMovedClientId((current) => (current === clientId ? null : current));
      }, 1200);
    } catch {
      setClients(previous);
      setKanbanCardsByStatus(previousByStatus);
      setMessage("Não foi possível atualizar status.");
    }
  };

  const onDragStartClient = (clientId: number) => {
    setDraggingClientId(clientId);
  };

  const onDropInColumn = async (status: LoanClientStatus) => {
    if (!draggingClientId) return;
    const movingClient = clients.find((item) => item.id === draggingClientId);
    setDragOverStatus(null);
    setDraggingClientId(null);
    if (!movingClient || movingClient.status === status) return;
    await onStatusChange(movingClient.id, status);
  };

  const onCreateInteraction = async (options?: { withSchedule?: boolean }) => {
    const withSchedule = options?.withSchedule ?? false;
    if (!selectedClientId) return;
    if (withSchedule && !interactionScheduledFor) {
      setMessage("Informe data e hora para o agendamento.");
      return;
    }
    if (!interactionText.trim()) {
      setMessage("Preencha a descrição da atividade.");
      return;
    }
    try {
      await createLoanInteraction(selectedClientId, {
        notes: interactionText,
        channel: interactionChannel,
        scheduledFor: withSchedule && interactionScheduledFor
          ? new Date(interactionScheduledFor).toISOString()
          : null,
      });
      setInteractionText("");
      setInteractionScheduledFor("");
      setIsActivityModalOpen(false);
      setIsScheduleModalOpen(false);
      invalidateLoanViewCaches();
      await loadClientDetails(selectedClientId);
      await refreshVisibleLoanData({ includeAgenda: true });
      setMessage("Interacao registrada.");
    } catch {
      setMessage("Falha ao registrar interação.");
    }
  };

  const onSelectAgendaSlot = (slotInfo: unknown) => {
    const startDate =
      typeof slotInfo === "object" &&
      slotInfo &&
      "start" in (slotInfo as { start?: unknown }) &&
      (slotInfo as { start?: unknown }).start instanceof Date
        ? (slotInfo as { start: Date }).start
        : new Date();
    setQuickAgendaForm((prev) => ({
      ...prev,
      scheduledFor: toDateTimeLocalValue(startDate),
    }));
    setIsQuickAgendaModalOpen(true);
  };

  const onAgendaEventDrop = async (dropInfo: unknown) => {
    const event = (dropInfo as { event?: { resource?: LoanAgendaItem }; start?: Date }).event;
    const start = (dropInfo as { start?: Date }).start;
    const item = event?.resource;
    if (!item || !(start instanceof Date)) return;
    try {
      await rescheduleLoanAgendaItem(item.id, start.toISOString());
      invalidateLoanViewCaches();
      await refreshVisibleLoanData({ includeAgenda: true });
      setMessage("Agendamento reagendado.");
    } catch {
      setMessage("Não foi possível reagendar o agendamento.");
    }
  };

  const onCreateQuickAgenda = async (event: FormEvent) => {
    event.preventDefault();
    const clientId = Number(quickAgendaForm.clientId || 0);
    if (!clientId) {
      setMessage("Selecione um cliente para agendar.");
      return;
    }
    setIsSavingQuickAgenda(true);
    try {
      await createLoanInteraction(clientId, {
        notes: quickAgendaForm.notes.trim() || "Agendamento criado no calendário",
        channel: quickAgendaForm.channel.trim() || "presencial",
        scheduledFor: quickAgendaForm.scheduledFor
          ? new Date(quickAgendaForm.scheduledFor).toISOString()
          : new Date().toISOString(),
      });
      setQuickAgendaForm({
        clientId: "",
        channel: "presencial",
        notes: "",
        scheduledFor: "",
      });
      setIsQuickAgendaModalOpen(false);
      invalidateLoanViewCaches();
      await refreshVisibleLoanData({ includeAgenda: true });
      setMessage("Agendamento criado.");
    } catch {
      setMessage("Falha ao criar agendamento.");
    } finally {
      setIsSavingQuickAgenda(false);
    }
  };

  const onCreateSimulation = async (event: FormEvent) => {
    event.preventDefault();
    const targetClientId = simClientId ?? selectedClientId;
    if (!targetClientId) return;
    try {
      await createLoanSimulation(targetClientId, {
        productId: simForm.productId ? Number(simForm.productId) : null,
        productType: simForm.productType,
        principal: Number(simForm.principal),
        installments: Number(simForm.installments),
        monthlyRate: Number(simForm.monthlyRate),
      });
      invalidateLoanViewCaches();
      await loadClientDetails(targetClientId);
      await refreshVisibleLoanData();
      setIsSimulationModalOpen(false);
      setMessage("Simulação salva.");
    } catch {
      setMessage("Falha ao salvar simulação.");
    }
  };

  const onCreateProduct = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await createLoanProduct({
        name: productForm.name,
        productType: productForm.productType,
        defaultRate: Number(productForm.defaultRate),
        minTerm: Number(productForm.minTerm),
        maxTerm: Number(productForm.maxTerm),
        active: productForm.active,
      });
      setProductForm({
        name: "",
        productType: "credito",
        defaultRate: "",
        minTerm: "",
        maxTerm: "",
        active: true,
      });
      setProducts(await listLoanProducts());
      setMessage("Produto criado.");
    } catch {
      setMessage("Falha ao criar produto.");
    }
  };

  const onProductSelect = (event: ChangeEvent<HTMLSelectElement>) => {
    const productId = event.target.value;
    const selected = products.find((item) => String(item.id) === productId);
    setSimForm((prev) => ({
      ...prev,
      productId,
      productType: selected?.productType ?? prev.productType,
      monthlyRate: selected ? String(selected.defaultRate) : prev.monthlyRate,
      installments: selected ? String(selected.minTerm) : prev.installments,
    }));
  };

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(firstSheet, { header: 1, blankrows: false });
    if (rows.length <= 1) {
      setMessage("Arquivo vazio.");
      return;
    }
    const headers = rows[0].map((value) => String(value ?? "").trim());
    const body = rows.slice(1).map((row) => headers.map((_, index) => String(row[index] ?? "")));
    setImportHeaders(headers);
    setImportRows(body);

    const normalizedHeaders = headers.map((item) => item.toLowerCase());
    const find = (candidates: string[]) =>
      headers[normalizedHeaders.findIndex((header) => candidates.some((key) => header.includes(key)))];

    setImportMap({
      name: find(["nome"]) ?? "",
      cpf: find(["cpf"]) ?? "",
      phone: find(["telefone", "celular", "fone"]) ?? "",
      city: find(["cidade"]) ?? "",
      profession: find(["profissao", "profiss", "cargo", "ocupacao"]) ?? "",
      convenio: find(["convenio", "conv"]) ?? "",
      income: find(["renda", "salario"]) ?? "",
      source: find(["origem", "source"]) ?? "",
    });
  };

  const getMappedValue = (row: string[], columnName: string): string => {
    const index = importHeaders.findIndex((header) => header === columnName);
    return index >= 0 ? row[index] ?? "" : "";
  };

  const importPreview = useMemo(() => {
    if (!importRows.length || !importMap.name || !importMap.cpf || !importMap.phone) return [];
    return importRows.slice(0, 10).map((row) => ({
      name: getMappedValue(row, importMap.name),
      cpf: getMappedValue(row, importMap.cpf),
      phones: [getMappedValue(row, importMap.phone)].filter(Boolean),
      city: importMap.city ? getMappedValue(row, importMap.city) : "",
      profession: importMap.profession ? getMappedValue(row, importMap.profession) : "",
      convenio: importMap.convenio ? getMappedValue(row, importMap.convenio) : "INSS",
      income: importMap.income ? Number(getMappedValue(row, importMap.income).replace(",", ".")) || 0 : 0,
      source: importMap.source ? getMappedValue(row, importMap.source) || importSource : importSource,
      status: "novo" as LoanClientStatus,
    }));
  }, [importRows, importMap, importSource, importHeaders]);

  const onImportLeads = async () => {
    if (!importRows.length || !importMap.name || !importMap.cpf || !importMap.phone) {
      setMessage("Mapeie nome, cpf e telefone antes de importar.");
      return;
    }
    setMessage("");
    const leads = importRows.map((row) => ({
      name: getMappedValue(row, importMap.name),
      cpf: getMappedValue(row, importMap.cpf),
      phones: [getMappedValue(row, importMap.phone)].filter(Boolean),
      city: importMap.city ? getMappedValue(row, importMap.city) : "",
      profession: importMap.profession ? getMappedValue(row, importMap.profession) : "",
      convenio: importMap.convenio ? getMappedValue(row, importMap.convenio) : "INSS",
      income: importMap.income ? Number(getMappedValue(row, importMap.income).replace(",", ".")) || 0 : 0,
      source: importMap.source ? getMappedValue(row, importMap.source) || importSource : importSource,
      status: "novo" as LoanClientStatus,
    }));
    try {
      const chunkSize = 100;
      let totalImported = 0;
      let totalDuplicated = 0;
      let processedCount = 0;
      leadImportCancelRef.current = false;
      setIsCancellingLeadImport(false);
      setLeadImportProgress({
        total: leads.length,
        processed: 0,
        imported: 0,
        duplicates: 0,
        running: true,
      });
      let cancelled = false;
      for (let start = 0; start < leads.length; start += chunkSize) {
        if (leadImportCancelRef.current) {
          cancelled = true;
          break;
        }
        const chunk = leads.slice(start, start + chunkSize);
        const result = await importLoanLeads({ source: importSource, leads: chunk });
        totalImported += result.importedRows;
        totalDuplicated += result.duplicateRows;
        processedCount = Math.min(start + chunk.length, leads.length);
        setLeadImportProgress({
          total: leads.length,
          processed: processedCount,
          imported: totalImported,
          duplicates: totalDuplicated,
          running: true,
        });
        if (leadImportCancelRef.current) {
          cancelled = true;
          break;
        }
      }
      if (cancelled) {
        setLeadImportProgress((prev) =>
          prev
            ? {
                ...prev,
                running: false,
              }
            : null,
        );
        setMessage(
          `Importacao interrompida. Processados: ${Math.min(
            processedCount,
            leads.length,
          )}/${leads.length}. Importados: ${totalImported}. Duplicados: ${totalDuplicated}.`,
        );
        return;
      }
      setImportPreviewCount(totalImported);
      setIsImportModalOpen(false);
      setMessage(
        `Importação concluída. Entradas: ${leads.length}. Importados: ${totalImported}. Duplicados: ${totalDuplicated}.`,
      );
      invalidateLoanViewCaches();
      await refreshVisibleLoanData();
      setLeadImportProgress(null);
    } catch (error) {
      setLeadImportProgress((prev) =>
        prev
          ? {
              ...prev,
              running: false,
            }
          : null,
      );
      setMessage(extractApiMessage(error, "Falha ao importar leads."));
    } finally {
      setIsCancellingLeadImport(false);
      leadImportCancelRef.current = false;
    }
  };

  const onImportarServidores = async (event: FormEvent) => {
    event.preventDefault();
    setIsImportandoServidores(true);
    setServidoresResultado(null);
    setMessage("");
    try {
      const result = await importarServidoresPortal({
        ano: servidoresForm.ano,
        mes: servidoresForm.mes,
        nome: servidoresForm.nome.trim() || undefined,
        tamanho: servidoresForm.tamanho,
        maxPaginas: servidoresForm.maxPaginas,
      });
      setServidoresImportJob({
        jobId: result.jobId,
        status: "running",
        processados: 0,
        estimadoTotal: Math.max(
          1,
          (servidoresForm.nome.trim() ? 1 : 5) * servidoresForm.maxPaginas * servidoresForm.tamanho,
        ),
        importados: 0,
        duplicados: 0,
        erros: 0,
      });
      setIsServidoresModalOpen(false);
      setMessage("Importacao iniciada em segundo plano.");
    } catch (error) {
      const responseMessage =
        typeof error === "object" &&
        error &&
        "response" in error &&
        typeof error.response === "object" &&
        error.response &&
        "data" in error.response &&
        typeof error.response.data === "object" &&
        error.response.data &&
        "message" in error.response.data &&
        typeof error.response.data.message === "string"
          ? error.response.data.message
          : null;
      setMessage(
        responseMessage ?? "Falha ao importar servidores do Portal da Transparência.",
      );
    } finally {
      setIsImportandoServidores(false);
    }
  };

  const openWhatsAppForClient = (client: LoanClient, text?: string) => {
    const phoneRaw = client.phones[0] ?? "";
    const phone = phoneRaw.replace(/\D/g, "");
    if (!phone) {
      setMessage("Cliente sem telefone válido para WhatsApp.");
      return;
    }
    void markLoanClientActivityTouch(client.id, "whatsapp");
    const content = text?.trim() ? `?text=${encodeURIComponent(text)}` : "";
    window.open(`https://wa.me/55${phone}${content}`, "_blank", "noopener,noreferrer");
  };

  const onOpenTemplateModal = (client: LoanClient) => {
    const baseTemplate = templateLibrary[0] || DEFAULT_MESSAGE_TEMPLATES[0];
    setTemplateClientId(client.id);
    setSelectedTemplateBase(baseTemplate);
    setTemplateText(applyTemplateTags(baseTemplate, client));
    setNewTemplateDraft("");
    setIsTemplateModalOpen(true);
    setWhatsMenuClientId(null);
  };

  const onSaveTemplate = () => {
    const nextTemplate = newTemplateDraft.trim();
    if (!nextTemplate) return;

    if (isEditingTemplate && !isDefaultTemplate(selectedTemplateBase)) {
      const selectedNormalized = selectedTemplateBase.trim().toLowerCase();
      const duplicate = templateLibrary.some((item) => {
        const normalized = item.trim().toLowerCase();
        return normalized !== selectedNormalized && normalized === nextTemplate.toLowerCase();
      });
      if (duplicate) {
        setMessage("Esse template já existe.");
        return;
      }

      const nextLibrary = templateLibrary.map((item) =>
        item.trim().toLowerCase() === selectedNormalized ? nextTemplate : item,
      );
      setTemplateLibrary(nextLibrary);
      setSelectedTemplateBase(nextTemplate);
      if (templateClient) {
        setTemplateText(applyTemplateTags(nextTemplate, templateClient));
      }
      setNewTemplateDraft("");
      setIsEditingTemplate(false);
      setMessage("Template atualizado.");
      return;
    }

    const exists = templateLibrary.some((item) => item.trim().toLowerCase() === nextTemplate.toLowerCase());
    if (exists) {
      setMessage("Esse template já existe.");
      return;
    }
    setTemplateLibrary((prev) => [nextTemplate, ...prev]);
    setSelectedTemplateBase(nextTemplate);
    if (templateClient) {
      setTemplateText(applyTemplateTags(nextTemplate, templateClient));
    }
    setNewTemplateDraft("");
    setIsEditingTemplate(false);
    setMessage("Template adicionado.");
  };

  const onEditSelectedTemplate = () => {
    if (isDefaultTemplate(selectedTemplateBase)) {
      setMessage("Templates padrão não podem ser editados.");
      return;
    }
    setNewTemplateDraft(selectedTemplateBase);
    setIsEditingTemplate(true);
    window.setTimeout(() => templateDraftTextareaRef.current?.focus(), 0);
  };

  const onRemoveSelectedTemplate = () => {
    if (isDefaultTemplate(selectedTemplateBase)) {
      setMessage("Templates padrão não podem ser removidos.");
      return;
    }
    const nextLibrary = templateLibrary.filter(
      (item) => item.trim().toLowerCase() !== selectedTemplateBase.trim().toLowerCase(),
    );
    const fallbackTemplate = nextLibrary[0] || DEFAULT_MESSAGE_TEMPLATES[0];
    setTemplateLibrary(nextLibrary.length > 0 ? nextLibrary : [...DEFAULT_MESSAGE_TEMPLATES]);
    setSelectedTemplateBase(fallbackTemplate);
    if (templateClient) {
      setTemplateText(applyTemplateTags(fallbackTemplate, templateClient));
    }
    setIsEditingTemplate(false);
    setNewTemplateDraft("");
    setMessage("Template removido.");
  };

  const onInsertTemplateTag = (tag: string) => {
    const field = templateDraftTextareaRef.current;
    setNewTemplateDraft((current) => {
      if (!field) {
        const divider = current.trim().length > 0 ? " " : "";
        return `${current}${divider}${tag}`.trim();
      }
      const start = field.selectionStart ?? current.length;
      const end = field.selectionEnd ?? current.length;
      const next = `${current.slice(0, start)}${tag}${current.slice(end)}`;
      window.setTimeout(() => {
        const cursorPos = start + tag.length;
        field.focus();
        field.setSelectionRange(cursorPos, cursorPos);
      }, 0);
      return next;
    });
  };

  const onOpenTemplateManagerModal = () => {
    setNewTemplateDraft("");
    setIsEditingTemplate(false);
    setIsTemplateManagerModalOpen(true);
  };

  const onOpenSimulationModal = (client: LoanClient) => {
    void markLoanClientActivityTouch(client.id, "simulation");
    setSelectedClientId(client.id);
    setSimClientId(client.id);
    setIsSimulationModalOpen(true);
    setWhatsMenuClientId(null);
  };

  const onOpenAgendaClient = async (item: LoanAgendaItem) => {
    try {
      const client = await getLoanClientById(item.clientId);
      setClients((current) => {
        const exists = current.some((entry) => entry.id === client.id);
        if (exists) {
          return current.map((entry) => (entry.id === client.id ? client : entry));
        }
        return [client, ...current];
      });
      setLoanSection("funil");
      setSelectedClientId(client.id);
      setIsClientDetailsModalOpen(true);
    } catch {
      setMessage("Não foi possível abrir o cliente da agenda.");
    }
  };

  const onConcluirAgendaItem = async (item: LoanAgendaItem) => {
    const confirmed = window.confirm(`Concluir o agendamento de ${item.clientName}?`);
    if (!confirmed) return;
    setLoadingAgendaCompleteId(item.id);
    try {
      await completeLoanAgendaItem(item.id);
      setMessage(`Contato de ${item.clientName} concluído.`);
      invalidateLoanViewCaches();
      await refreshVisibleLoanData({ includeAgenda: true });
    } catch {
      setMessage("Não foi possível concluir o agendamento.");
    } finally {
      setLoadingAgendaCompleteId((current) => (current === item.id ? null : current));
    }
  };

  const toggleServidorDetalhes = (id: number) => {
    setServidoresExpandidos((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const onSaveLoanSettings = async () => {
    const marginValue = Number(consignableMarginPercent);
    const consignadoValue = Number(consignadoRate);
    const pessoalValue = Number(pessoalRate);
    if (!Number.isFinite(marginValue) || marginValue <= 0 || marginValue > 100) {
      setMessage("Percentual de margem inválido. Use um valor entre 1 e 100.");
      return;
    }
    if (!Number.isFinite(consignadoValue) || consignadoValue <= 0 || consignadoValue > 20) {
      setMessage("Taxa de consignado inválida. Use entre 0.1 e 20.");
      return;
    }
    if (!Number.isFinite(pessoalValue) || pessoalValue <= 0 || pessoalValue > 20) {
      setMessage("Taxa de pessoal inválida. Use entre 0.1 e 20.");
      return;
    }
    setIsSavingLoanSettings(true);
    try {
      const updated = await updateLoanSettings({
        consignableMarginPercent: marginValue,
        consignadoRate: consignadoValue,
        pessoalRate: pessoalValue,
      });
      setConsignableMarginPercent(String(updated.consignableMarginPercent));
      setConsignadoRate(String(updated.consignadoRate));
      setPessoalRate(String(updated.pessoalRate));
      setMessage("Configurações de margem e taxas atualizadas.");
    } catch {
      setMessage("Falha ao salvar configuração de margem.");
    } finally {
      setIsSavingLoanSettings(false);
    }
  };

  const scoreBadge = (classificacaoScore: ImportedServant["classificacaoScore"]): string => {
    if (classificacaoScore === "Quente") return "🔥 Quente";
    if (classificacaoScore === "Morno") return "🟡 Morno";
    return "❄ Frio";
  };

  const prioridadeBadge = (prioridade: ImportedServant["prioridadeAtendimento"]): string => {
    if (prioridade === "Alta") return "🔥 Alta";
    if (prioridade === "Baixa") return "❄ Baixa";
    return "🟡 Media";
  };
  const getClientHeatLevel = (client: LoanClient): "Quente" | "Morno" | "Frio" => {
    if (client.heatBadge === "Quente") return "Quente";
    if (client.heatBadge === "Morno") return "Morno";
    if (client.heatBadge === "Frio") return "Frio";
    const margem = getMargemDisponivel(client);
    if (margem >= 400) return "Quente";
    if (margem >= 150) return "Morno";
    return "Frio";
  };
  const getHeatBadgeClassName = (client: LoanClient): string => {
    const level = getClientHeatLevel(client).toLowerCase();
    return `loan-heat-${level}`;
  };
  const getConsignadoStatus = (client: LoanClient): "Com consignado" | "Sem consignado" => {
    return client.convenio?.trim() ? "Com consignado" : "Sem consignado";
  };
  const getMargemDisponivel = (client: LoanClient): number => {
    const income = Number(client.income ?? 0);
    if (!Number.isFinite(income) || income <= 0) return 0;
    return (income * Number(consignableMarginPercent || "30")) / 100;
  };
  const getClientQuickSimulation = (client: LoanClient) => {
    const margemDisponivel = getMargemDisponivel(client);
    if (margemDisponivel <= 0) return null;
    const monthlyRate = Number(consignadoRate || "1.8") / 100;
    const terms = [36, 48, 60, 72];
    let best = { installments: 0, principal: 0, installmentValue: margemDisponivel };
    for (const installments of terms) {
      const principal =
        monthlyRate > 0
          ? margemDisponivel * ((1 - (1 + monthlyRate) ** -installments) / monthlyRate)
          : margemDisponivel * installments;
      if (principal > best.principal) {
        best = { installments, principal, installmentValue: margemDisponivel };
      }
    }
    return best;
  };
  const getRecommendedProduct = (client: LoanClient): string => {
    const margem = getMargemDisponivel(client);
    if (margem <= 0) return "Sem margem";
    if (getConsignadoStatus(client) === "Sem consignado") return "Primeiro consignado";
    if (margem < 200) return "Refinanciamento";
    return "Crédito consignado";
  };
  const getClientLoanValue = (client: LoanClient): number => {
    return getClientQuickSimulation(client)?.principal ?? 0;
  };
  const getAgendaSituationClassName = (item: LoanAgendaItem): string => {
    if (item.completedAt) return "completed";
    if (item.status === "ganho") return "won";
    if (item.status === "perdido") return "lost";
    return "pending";
  };
  const getNextStatus = (status: LoanClientStatus): LoanClientStatus | null => {
    const currentIndex = statusFlow.findIndex((item) => item.key === status);
    if (currentIndex < 0 || currentIndex >= statusFlow.length - 1) return null;
    return statusFlow[currentIndex + 1]?.key ?? null;
  };
  const onMoveClientToStatus = async (client: LoanClient, status: LoanClientStatus, reason?: string) => {
    setMovingNextStageClientId(client.id);
    try {
      await onStatusChange(client.id, status);
      if (status === "perdido" && reason?.trim()) {
        await createLoanInteraction(client.id, {
          notes: `Motivo da perda: ${reason.trim()}`,
          channel: "presencial",
          scheduledFor: null,
        });
      }
      await loadClientDetails(client.id);
      setMessage(`Cliente movido para ${statusFlow.find((item) => item.key === status)?.label ?? status}.`);
    } finally {
      setMovingNextStageClientId((current) => (current === client.id ? null : current));
    }
  };
  const onMoveToNextStage = async (client: LoanClient) => {
    const nextStatus = getNextStatus(client.status);
    if (!nextStatus) return;
    await onMoveClientToStatus(client, nextStatus);
  };
  const onOpenLostReasonModal = () => {
    setLostReasonText("");
    setIsLostReasonModalOpen(true);
  };

  const onConfirmLostReason = async () => {
    if (!selectedClient) return;
    if (!lostReasonText.trim()) {
      setMessage("Informe o motivo da perda.");
      return;
    }
    try {
      setIsLostReasonModalOpen(false);
      await onMoveClientToStatus(selectedClient, "perdido", lostReasonText);
      setLostReasonText("");
    } catch {
      setMessage("Não foi possível concluir a perda.");
    }
  };
  const onUpdateClientHeatBadge = async (clientId: number, heatBadge: "Quente" | "Morno" | "Frio" | null) => {
    try {
      await updateLoanClientHeatBadge(clientId, heatBadge);
      invalidateLoanViewCaches();
      setClients((current) =>
        current.map((item) => (item.id === clientId ? { ...item, heatBadge } : item)),
      );
      setKanbanCardsByStatus((current) =>
        statusFlow.reduce(
          (acc, column) => ({
            ...acc,
            [column.key]: (current[column.key] ?? []).map((item) =>
              item.id === clientId ? { ...item, heatBadge } : item,
            ),
          }),
          {} as Record<LoanClientStatus, LoanClient[]>,
        ),
      );
      setMessage("Badge atualizado.");
    } catch {
      setMessage("Não foi possível atualizar o badge.");
    }
  };
  const onSaveClientSummary = async () => {
    if (!selectedClient) return;
    try {
      const marginAvailable = Number(clientSummaryForm.marginAvailable || 0);
      const incomeFromMargin =
        Number.isFinite(marginAvailable) && marginAvailable >= 0
          ? (marginAvailable * 100) / Number(consignableMarginPercent || "30")
          : Number(clientSummaryForm.income || 0);
      await updateLoanClient(selectedClient.id, {
        name: clientSummaryForm.name.trim() || selectedClient.name,
        cpf: clientSummaryForm.cpf.trim() || selectedClient.cpf,
        phones:
          clientSummaryForm.phones.trim().length > 0
            ? clientSummaryForm.phones
                .split(/[,;]+/)
                .map((item) => item.trim())
                .filter(Boolean)
            : selectedClient.phones,
        city: clientSummaryForm.city.trim(),
        profession: clientSummaryForm.profession.trim(),
        convenio: clientSummaryForm.convenio.trim(),
        income: Number.isFinite(incomeFromMargin) ? incomeFromMargin : Number(clientSummaryForm.income || 0),
        heatBadge: selectedClient.heatBadge ?? null,
        source: clientSummaryForm.source.trim() || "manual",
        status: clientSummaryForm.status,
        assignedUserId: selectedClient.assignedUserId ?? undefined,
      });
      invalidateLoanViewCaches();
      const refreshedClient = await getLoanClientById(selectedClient.id);
      setClients((current) =>
        current.some((item) => item.id === refreshedClient.id)
          ? current.map((item) => (item.id === refreshedClient.id ? refreshedClient : item))
          : [refreshedClient, ...current],
      );
      setSummaryOverrides((current) => ({
        ...current,
        [selectedClient.id]: {
          simulation: clientSummaryForm.simulation,
          product: clientSummaryForm.product,
        },
      }));
      setIsSummaryEditing(false);
      setMessage("Resumo do cliente atualizado.");
    } catch {
      setMessage("Não foi possível atualizar o resumo do cliente.");
    }
  };
  const onKanbanMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".loan-client-card")) return;
    const container = kanbanScrollRef.current;
    if (!container) return;
    isKanbanDraggingRef.current = true;
    kanbanDragStartXRef.current = event.clientX;
    kanbanStartScrollLeftRef.current = container.scrollLeft;
    container.classList.add("dragging");
  };
  const onKanbanMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isKanbanDraggingRef.current) return;
    const container = kanbanScrollRef.current;
    if (!container) return;
    const delta = event.clientX - kanbanDragStartXRef.current;
    container.scrollLeft = kanbanStartScrollLeftRef.current - delta;
  };
  const onKanbanMouseUp = () => {
    isKanbanDraggingRef.current = false;
    kanbanScrollRef.current?.classList.remove("dragging");
  };

  function formatCurrency(value: number): string {
    return `R$ ${Number(value).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  const getAgendaEventStyle = (event: unknown) => {
    const item = (event as { resource?: LoanAgendaItem }).resource;
    if (!item) return { style: {} as CSSProperties };
    if (item.completedAt) {
      return {
        style: {
          backgroundColor: "#eaf4ff",
          borderColor: "#8fbbe7",
          color: "#1a4f80",
        } as CSSProperties,
      };
    }
    const colorsByStatus: Record<LoanClientStatus, { bg: string; border: string; text: string }> = {
      novo: { bg: "#eff6ff", border: "#9ec4ef", text: "#184a77" },
      em_atendimento: { bg: "#eef9f4", border: "#93d7b5", text: "#1e6b44" },
      simulacao: { bg: "#fff8e9", border: "#f0cf8a", text: "#8a6100" },
      em_analise: { bg: "#f4f1ff", border: "#b9a8ef", text: "#4f3ea2" },
      digitacao: { bg: "#ecf8ff", border: "#8ecbe8", text: "#176284" },
      seguro_ap: { bg: "#fff1f8", border: "#ebb1d0", text: "#8a2a5f" },
      assinatura: { bg: "#f3f7ec", border: "#b5d093", text: "#466326" },
      pagamento: { bg: "#effff6", border: "#93d9ad", text: "#1f6b3e" },
      ganho: { bg: "#e8fff3", border: "#79d3a1", text: "#166641" },
      perdido: { bg: "#fff0f0", border: "#e1a8a8", text: "#8a2e2e" },
    };
    const palette = colorsByStatus[item.status] ?? colorsByStatus.novo;
    return {
      style: {
        backgroundColor: palette.bg,
        borderColor: palette.border,
        color: palette.text,
        } as CSSProperties,
    };
  };

  const onSimularServidorAgora = async (id: number) => {
    setSimulandoServidorId(id);
    try {
      const result = await simularServidorAgora(id);
      setServidoresImportados((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                valorMaximoLiberado: result.valorMaximoLiberado,
                melhorParcela: result.melhorParcela,
                melhorPrazo: result.melhorPrazo,
                totalPago: result.totalPago,
                produtoRecomendado: result.produtoRecomendado,
                prioridadeAtendimento: result.prioridadeAtendimento,
              }
            : item,
        ),
      );
      await loadServidoresData();
      setSimulacoesRecentesIds((current) => (current.includes(id) ? current : [...current, id]));
      window.setTimeout(() => {
        setSimulacoesRecentesIds((current) => current.filter((itemId) => itemId !== id));
      }, 5000);
      setMessage("Simulação atualizada com sucesso.");
    } catch (error) {
      const responseMessage =
        typeof error === "object" &&
        error &&
        "response" in error &&
        typeof error.response === "object" &&
        error.response &&
        "data" in error.response &&
        typeof error.response.data === "object" &&
        error.response.data &&
        "message" in error.response.data &&
        typeof error.response.data.message === "string"
          ? error.response.data.message
          : null;
      setMessage(responseMessage ?? "Falha ao simular servidor.");
    } finally {
      setSimulandoServidorId(null);
    }
  };

  const onCadastrarServidor = (servant: ImportedServant) => {
    setEditingClientId(null);
    setClientForm({
      name: servant.name,
      cpf: "",
      phones: [""],
      city: servant.lotacao || "",
      profession: "",
      convenio: "INSS",
      income: String(Number(servant.valorLiquido || 0)),
      heatBadge: null,
      source: `portal_transparencia:${servant.unidadeGestora || "sergipe"}`,
      status: "novo",
      assignedUserId: user?.id ?? sellerOptions[0]?.id ?? 0,
      assignedUserName: user?.name ?? sellerOptions[0]?.name ?? "",
    });
    setIsClientModalOpen(true);
    setMessage("Complete CPF e telefones para concluir o cadastro do cliente.");
  };

  const onToggleCadastroSort = (sortBy: CadastroSortBy) => {
    setCadastroFiltro((prev) => ({
      ...prev,
      sortBy,
      sortDir: prev.sortBy === sortBy ? (prev.sortDir === "asc" ? "desc" : "asc") : "asc",
    }));
    setCadastroPaginacao((prev) => ({ ...prev, page: 1 }));
  };

  const getCadastroSortIndicator = (sortBy: CadastroSortBy) => {
    if (cadastroFiltro.sortBy !== sortBy) return "↕";
    return cadastroFiltro.sortDir === "asc" ? "↑" : "↓";
  };

  if (loading) return <p>Carregando CRM de empréstimos...</p>;
  const progressoImportacaoPercentual =
    servidoresImportJob && servidoresImportJob.estimadoTotal > 0
      ? Math.min(100, Math.round((servidoresImportJob.processados / servidoresImportJob.estimadoTotal) * 100))
      : 0;
  const progressoImportacaoLeadsPercentual =
    leadImportProgress && leadImportProgress.total > 0
      ? Math.min(100, Math.round((leadImportProgress.processed / leadImportProgress.total) * 100))
      : 0;
  const feedbackTone: "success" | "error" | "info" = (() => {
    const text = message.trim().toLowerCase();
    if (!text) return "info";
    if (
      text.includes("falha") ||
      text.includes("erro") ||
      text.includes("não foi possível") ||
      text.includes("inválido") ||
      text.includes("inválida") ||
      text.includes("sem permissao")
    ) {
      return "error";
    }
    if (
      text.includes("concluída") ||
      text.includes("cadastrado") ||
      text.includes("atualizada") ||
      text.includes("registrada") ||
      text.includes("salva") ||
      text.includes("iniciada")
    ) {
      return "success";
    }
    return "info";
  })();

  return (
    <div className="loan-page">
      <section className="loan-subbar loan-section-menu">
        <button
          type="button"
          className={loanSection === "cadastro" ? "active" : ""}
          onClick={() => {
            setLoanSection("cadastro");
            setIsImportMenuOpen(false);
          }}
        >
          <span className="loan-menu-icon-label">
            <MenuCadastroIcon />
            <span>Cadastro</span>
          </span>
        </button>
        <button
          type="button"
          className={loanSection === "funil" ? "active" : ""}
          onClick={() => {
            setLoanSection("funil");
            setIsImportMenuOpen(false);
          }}
        >
          <span className="loan-menu-icon-label">
            <MenuFunilIcon />
            <span>Funil de Vendas</span>
          </span>
        </button>
        <button
          type="button"
          className={loanSection === "agenda" ? "active" : ""}
          onClick={() => {
            setLoanSection("agenda");
            setIsImportMenuOpen(false);
          }}
        >
          <span className="loan-menu-icon-label">
            <MenuAgendaIcon />
            <span>Agenda</span>
          </span>
        </button>
        <button
          type="button"
          className={loanSection === "importacoes" ? "active" : ""}
          onClick={() => setLoanSection("importacoes")}
        >
          <span className="loan-menu-icon-label">
            <MenuImportIcon />
            <span>Importações</span>
          </span>
        </button>
        <button
          type="button"
          className={loanSection === "comissao" ? "active" : ""}
          onClick={() => setLoanSection("comissao")}
        >
          <span className="loan-menu-icon-label">
            <MenuComissaoIcon />
            <span>Comissões</span>
          </span>
        </button>
      </section>

      {loanSection === "funil" ? (
        <section className="card loan-dashboard">
          <div className="section-header-row loan-dashboard-header">
            <h3 className="loan-title-icon-label">
              <MenuFunilIcon />
              <span>Funil de Vendas</span>
            </h3>
          </div>
          <div className="loan-metrics">
            <article>
              <strong>{dashboard?.totalClients ?? 0}</strong>
              <span>Total de clientes</span>
            </article>
            <article>
              <strong>{novosLeadsTotal}</strong>
              <span>Novos Leads</span>
            </article>
            <article>
              <strong>{dashboard?.noContactClients ?? 0}</strong>
              <span>Retomar contato (3+ dias)</span>
            </article>
            <article>
              <strong>{dashboard?.wonClients ?? dashboard?.conversions ?? 0}</strong>
              <span>Ganho</span>
            </article>
            <article>
              <strong>{dashboard?.lostClients ?? 0}</strong>
              <span>Perdido</span>
            </article>
          </div>
          {isAdmin ? (
            <div className="loan-settings-row">
              <label>
                Margem consignavel padrao (%)
                <input
                  type="number"
                  min={1}
                  max={100}
                  step="0.1"
                  value={consignableMarginPercent}
                  onChange={(event) => setConsignableMarginPercent(event.target.value)}
                />
              </label>
              <label>
                Taxa consignado (% a.m.)
                <input
                  type="number"
                  min={0.1}
                  max={20}
                  step="0.1"
                  value={consignadoRate}
                  onChange={(event) => setConsignadoRate(event.target.value)}
                />
              </label>
              <label>
                Taxa pessoal (% a.m.)
                <input
                  type="number"
                  min={0.1}
                  max={20}
                  step="0.1"
                  value={pessoalRate}
                  onChange={(event) => setPessoalRate(event.target.value)}
                />
              </label>
              <button type="button" onClick={onSaveLoanSettings} disabled={isSavingLoanSettings}>
                {isSavingLoanSettings ? "Salvando..." : "Salvar configurações"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {loanSection === "cadastro" ? (
        <section className="card loan-actions-panel">
          <div className="section-header-row">
            <h3 className="loan-title-icon-label">
              <MenuCadastroIcon />
              <span>Cadastro</span>
            </h3>
            <button
              className="transaction-top-action transaction-top-action-new"
              type="button"
              onClick={() => {
                setEditingClientId(null);
                setClientForm({
                  name: "",
                  cpf: "",
                  phones: [""],
                  city: "",
                  profession: "",
                  convenio: "INSS",
                  income: "",
                  heatBadge: null,
                  source: "manual",
                  status: "novo",
                  assignedUserId: user?.id ?? sellerOptions[0]?.id ?? 0,
                  assignedUserName: user?.name ?? sellerOptions[0]?.name ?? "",
                });
                setIsClientModalOpen(true);
              }}
            >
              <span className="button-icon-inline">
                <PlusIcon />
                <span>Novo</span>
              </span>
            </button>
          </div>
          <div className="loan-cadastro-filters">
            <input
              placeholder="Nome"
              value={cadastroFiltro.busca}
              onChange={(event) => {
                setCadastroFiltro((prev) => ({ ...prev, busca: event.target.value }));
                setCadastroPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            />
            <input
              placeholder="CPF"
              value={cadastroFiltro.cpf}
              onChange={(event) => {
                setCadastroFiltro((prev) => ({ ...prev, cpf: event.target.value }));
                setCadastroPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            />
            <input
              placeholder="Cidade"
              value={cadastroFiltro.city}
              onChange={(event) => {
                setCadastroFiltro((prev) => ({ ...prev, city: event.target.value }));
                setCadastroPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            />
            <input
              placeholder="Profissão"
              value={cadastroFiltro.profession}
              onChange={(event) => {
                setCadastroFiltro((prev) => ({ ...prev, profession: event.target.value }));
                setCadastroPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            />
            <input
              placeholder="Convênio"
              value={cadastroFiltro.convenio}
              onChange={(event) => {
                setCadastroFiltro((prev) => ({ ...prev, convenio: event.target.value }));
                setCadastroPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            />
            <select
              value={cadastroFiltro.vendedorId}
              onChange={(event) => {
                setCadastroFiltro((prev) => ({ ...prev, vendedorId: event.target.value }));
                setCadastroPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            >
              <option value="">Todos os vendedores</option>
              {sellerOptions.map((seller) => (
                <option key={seller.id} value={String(seller.id)}>
                  {seller.name}
                </option>
              ))}
            </select>
            <select
              value={cadastroFiltro.status}
              onChange={(event) => {
                setCadastroFiltro((prev) => ({ ...prev, status: event.target.value }));
                setCadastroPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            >
              <option value="">Todos os status</option>
              {statusFlow.map((status) => (
                <option key={`cadastro-status-${status.key}`} value={status.key}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
          <table>
            <thead>
              <tr>
                <th>
                  <button type="button" className="table-sort-button" onClick={() => onToggleCadastroSort("name")}>
                    Nome <span>{getCadastroSortIndicator("name")}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="table-sort-button" onClick={() => onToggleCadastroSort("cpf")}>
                    CPF <span>{getCadastroSortIndicator("cpf")}</span>
                  </button>
                </th>
                <th>Telefone</th>
                <th>
                  <button type="button" className="table-sort-button" onClick={() => onToggleCadastroSort("city")}>
                    Cidade <span>{getCadastroSortIndicator("city")}</span>
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="table-sort-button"
                    onClick={() => onToggleCadastroSort("profession")}
                  >
                    Profissão <span>{getCadastroSortIndicator("profession")}</span>
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="table-sort-button"
                    onClick={() => onToggleCadastroSort("convenio")}
                  >
                    Convênio <span>{getCadastroSortIndicator("convenio")}</span>
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className="table-sort-button"
                    onClick={() => onToggleCadastroSort("assignedUserName")}
                  >
                    Vendedor <span>{getCadastroSortIndicator("assignedUserName")}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="table-sort-button" onClick={() => onToggleCadastroSort("status")}>
                    Status <span>{getCadastroSortIndicator("status")}</span>
                  </button>
                </th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredCadastroClientes.length === 0 ? (
                <tr>
                  <td colSpan={9}>Nenhum cliente cadastrado.</td>
                </tr>
              ) : (
                filteredCadastroClientes.map((client) => (
                  <tr key={client.id}>
                    <td>{client.name}</td>
                    <td>{client.cpf}</td>
                    <td>{formatPhonesDisplay(client.phones)}</td>
                    <td>{client.city || "-"}</td>
                    <td>{client.profession || "-"}</td>
                    <td>{client.convenio || "-"}</td>
                    <td>{client.assignedUserName || "-"}</td>
                    <td>{statusFlow.find((status) => status.key === client.status)?.label ?? client.status}</td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="transaction-icon-button"
                          title="Editar cliente"
                          aria-label="Editar cliente"
                          onClick={() => onEditarCliente(client)}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="transaction-icon-button danger"
                          title="Excluir cliente"
                          aria-label="Excluir cliente"
                          onClick={() => void onExcluirClienteCadastro(client)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="loan-pagination-row">
            <span className="loan-hint">
              {cadastroPaginacao.total} clientes - página {cadastroPaginacao.page} de{" "}
              {cadastroPaginacao.totalPages}
            </span>
            <div className="row">
              <select
                value={String(cadastroPaginacao.pageSize)}
                onChange={(event) =>
                  setCadastroPaginacao((prev) => ({
                    ...prev,
                    page: 1,
                    pageSize: Number(event.target.value || 10),
                  }))
                }
              >
                <option value="10">10 por página</option>
                <option value="25">25 por página</option>
                <option value="50">50 por página</option>
                <option value="100">100 por página</option>
                <option value="200">200 por página</option>
              </select>
              <button
                type="button"
                disabled={cadastroPaginacao.page <= 1}
                onClick={() =>
                  setCadastroPaginacao((prev) => ({
                    ...prev,
                    page: Math.max(1, prev.page - 1),
                  }))
                }
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={cadastroPaginacao.page >= cadastroPaginacao.totalPages}
                onClick={() =>
                  setCadastroPaginacao((prev) => ({
                    ...prev,
                    page: Math.min(prev.totalPages, prev.page + 1),
                  }))
                }
              >
                Próxima
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {loanSection === "funil" ? (
      <section className="card loan-funil-card">
        <div className="loan-client-filter-row">
          <input
            placeholder="Buscar cliente"
            value={clientesFiltro.busca}
            onChange={(event) => {
              setClientesFiltro((prev) => ({ ...prev, busca: event.target.value }));
              setClientesPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          />
          <select
            value={clientesFiltro.status}
            onChange={(event) => {
              setClientesFiltro((prev) => ({ ...prev, status: event.target.value }));
              setClientesPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="">Todos os status</option>
            {statusFlow.map((status) => (
              <option key={`filtro-status-${status.key}`} value={status.key}>
                {status.label}
              </option>
            ))}
          </select>
          <select
            value={clientesFiltro.vendedorId}
            onChange={(event) => {
              setClientesFiltro((prev) => ({ ...prev, vendedorId: event.target.value }));
              setClientesPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="">Todos os vendedores</option>
            {sellerOptions.map((seller) => (
              <option key={seller.id} value={String(seller.id)}>
                {seller.name}
              </option>
            ))}
          </select>
          <select
            value={clientesFiltro.monthRef}
            onChange={(event) => {
              setClientesFiltro((prev) => ({ ...prev, monthRef: event.target.value }));
              setClientesPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            {monthFilterOptions.map((item) => (
              <option key={item.value || "all-months"} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            className="loan-filter-clear-button"
            type="button"
            onClick={() => {
              setClientesFiltro({ busca: "", status: "", vendedorId: "", monthRef: "" });
              setClientesPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            Limpar
          </button>
          <div className="loan-heat-legend" aria-label="Legenda de temperatura dos clientes">
            <span className="loan-heat-legend-title">Status:</span>
            <span className="loan-heat-legend-item">
              <span className="loan-heat-circle loan-heat-frio" />
              <small>Frio</small>
            </span>
            <span className="loan-heat-legend-item">
              <span className="loan-heat-circle loan-heat-morno" />
              <small>Morno</small>
            </span>
            <span className="loan-heat-legend-item">
              <span className="loan-heat-circle loan-heat-quente" />
              <small>Quente</small>
            </span>
          </div>
        </div>
        <div
          className="loan-kanban-scroll"
          ref={kanbanScrollRef}
          onMouseDown={onKanbanMouseDown}
          onMouseMove={onKanbanMouseMove}
          onMouseUp={onKanbanMouseUp}
          onMouseLeave={onKanbanMouseUp}
        >
        <div className="loan-kanban">
          {statusFlow.map((column) => (
            <article
              key={column.key}
              className={`loan-column ${dragOverStatus === column.key ? "active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverStatus(column.key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                void onDropInColumn(column.key);
              }}
            >
              <header>
                <div className="loan-column-title-row">
                  <strong>{column.label}</strong>
                  <span className="loan-column-count-badge">{kanbanColumnTotals[column.key] ?? 0}</span>
                </div>
              </header>
              <div className="loan-column-list">
                <div className="loan-drop-zone">
                {(() => {
                  const columnClients = kanbanCardsByStatus[column.key] ?? [];
                  if (columnClients.length === 0) {
                    return (
                      <div className="loan-column-empty">
                        <EmptyStageIcon />
                        <strong>Nenhum cliente nesta etapa</strong>
                        <small>Arraste um card para esta coluna.</small>
                      </div>
                    );
                  }
                  return columnClients.map((client) => (
                    <article
                      key={client.id}
                      className={`loan-client-card ${selectedClientId === client.id ? "selected" : ""} ${recentlyMovedClientId === client.id ? "moved" : ""}`}
                      draggable
                      onClick={() => {
                        setSelectedClientId(client.id);
                        setIsClientDetailsModalOpen(true);
                      }}
                      onDragStart={() => onDragStartClient(client.id)}
                      onDragEnd={() => {
                        setDraggingClientId(null);
                        setDragOverStatus(null);
                      }}
                    >
                      <div className="loan-client-card-top">
                        <strong className="loan-client-name-with-badge">
                          <span className={`loan-heat-circle ${getHeatBadgeClassName(client)}`} />
                          <span>{client.name}</span>
                        </strong>
                        <div className="loan-client-card-actions">
                          <div className="loan-client-action-wrap">
                            <button
                              type="button"
                              className="loan-client-icon-button"
                              data-tooltip="Ações WhatsApp"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedClientId(client.id);
                                setWhatsMenuClientId((current) =>
                                  current === client.id ? null : client.id,
                                );
                              }}
                            >
                              <WhatsAppIcon />
                            </button>
                            {whatsMenuClientId === client.id ? (
                              <div
                                className="loan-client-action-menu"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    openWhatsAppForClient(client);
                                    setWhatsMenuClientId(null);
                                  }}
                                >
                                  <span className="loan-client-action-menu-label">
                                    <WhatsAppIcon />
                                    <span>Abrir WhatsApp</span>
                                  </span>
                                </button>
                                <button type="button" onClick={() => onOpenTemplateModal(client)}>
                                  <span className="loan-client-action-menu-label">
                                    <TemplateSendIcon />
                                    <span>Enviar template</span>
                                  </span>
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="loan-client-icon-button"
                            data-tooltip="Adicionar agendamento"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedClientId(client.id);
                              setIsClientDetailsModalOpen(true);
                              setInteractionScheduledFor(getDefaultScheduleDateTimeLocal());
                              setIsScheduleModalOpen(true);
                            }}
                          >
                            <CalendarPlusIcon />
                          </button>
                        </div>
                      </div>
                      <div className="loan-client-card-body-button">
                        <div className="loan-client-info-line">
                          <span className="loan-client-info-value">
                            {client.city || "Cidade não informada"}
                          </span>
                        </div>
                        <div className="loan-client-info-line">
                          <span className="loan-client-info-value">
                            {formatPhonesDisplay(client.phones, "Sem telefone")}
                          </span>
                        </div>
                        <div className="loan-client-info-line loan-client-info-line-highlight">
                          <small className="loan-client-info-label">Margem disponível</small>
                          <strong className="loan-client-card-highlight">
                            {formatCurrency(getMargemDisponivel(client))}
                          </strong>
                        </div>
                      </div>
                    </article>
                  ));
                })()}
                </div>
              </div>
            </article>
          ))}
        </div>
        </div>
        <div className="loan-pagination-row">
          <span className="loan-hint">
            {clientesPaginacao.total} clientes - página {clientesPaginacao.page} de{" "}
            {clientesPaginacao.totalPages}
          </span>
          <div className="row">
            <select
              value={String(clientesPaginacao.pageSize)}
              onChange={(event) =>
                setClientesPaginacao((prev) => ({
                  ...prev,
                  page: 1,
                  pageSize: Number(event.target.value || 10),
                }))
              }
            >
              <option value="10">10 por página</option>
              <option value="25">25 por página</option>
              <option value="50">50 por página</option>
              <option value="100">100 por página</option>
              <option value="200">200 por página</option>
            </select>
            <button
              type="button"
              disabled={clientesPaginacao.page <= 1}
              onClick={() =>
                setClientesPaginacao((prev) => ({
                  ...prev,
                  page: Math.max(1, prev.page - 1),
                }))
              }
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={clientesPaginacao.page >= clientesPaginacao.totalPages}
              onClick={() =>
                setClientesPaginacao((prev) => ({
                  ...prev,
                  page: Math.min(prev.totalPages, prev.page + 1),
                }))
              }
            >
              Próxima
            </button>
          </div>
        </div>
      </section>
      ) : null}

      {isClientDetailsModalOpen && selectedClient ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-details" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row loan-client-modal-header">
              <div className="loan-client-modal-title-wrap">
                <div className="loan-client-title-row">
                  <h2>{selectedClient.name}</h2>
                  <div className="loan-heat-badge-wrap">
                    <button
                      type="button"
                      className={`loan-heat-badge-chip loan-heat-badge-chip-button ${getHeatBadgeClassName(selectedClient)}`}
                      onClick={() => setIsHeatBadgeMenuOpen((current) => !current)}
                      title="Alterar badge"
                    >
                      <span className={`loan-heat-circle ${getHeatBadgeClassName(selectedClient)}`} />
                      {getClientHeatLevel(selectedClient)}
                    </button>
                    {isHeatBadgeMenuOpen ? (
                      <div className="loan-heat-badge-menu">
                        <button
                          type="button"
                          onClick={() => {
                            void onUpdateClientHeatBadge(selectedClient.id, null);
                            setIsHeatBadgeMenuOpen(false);
                          }}
                        >
                          Automático
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void onUpdateClientHeatBadge(selectedClient.id, "Quente");
                            setIsHeatBadgeMenuOpen(false);
                          }}
                        >
                          Quente
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void onUpdateClientHeatBadge(selectedClient.id, "Morno");
                            setIsHeatBadgeMenuOpen(false);
                          }}
                        >
                          Morno
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void onUpdateClientHeatBadge(selectedClient.id, "Frio");
                            setIsHeatBadgeMenuOpen(false);
                          }}
                        >
                          Frio
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="loan-client-modal-meta">
                  <small>CPF: {selectedClient.cpf || "-"}</small>
                  <small>Vendedor: {selectedClient.assignedUserName || "-"}</small>
                  <small>Última atualização: {new Date(selectedClient.updatedAt).toLocaleString("pt-BR")}</small>
                </div>
              </div>
              <div className="loan-client-modal-header-actions">
                <button
                  type="button"
                  className="loan-client-modal-close"
                  onClick={() => {
                    setIsClientDetailsModalOpen(false);
                    setIsLostReasonModalOpen(false);
                  }}
                >
                  X
                </button>
                <div className="loan-client-modal-stage-actions">
                  <button
                    type="button"
                    className="danger-button loan-stage-left"
                    onClick={onOpenLostReasonModal}
                    disabled={selectedClient.status === "perdido" || movingNextStageClientId === selectedClient.id}
                  >
                    Perdido
                  </button>
                  <button
                    type="button"
                    className="primary-button loan-next-stage-button loan-stage-right"
                    onClick={() => void onMoveToNextStage(selectedClient)}
                    disabled={!getNextStatus(selectedClient.status) || movingNextStageClientId === selectedClient.id}
                  >
                    <span>
                      {movingNextStageClientId === selectedClient.id
                        ? "Movendo..."
                        : statusFlow.find((item) => item.key === getNextStatus(selectedClient.status))?.label ??
                          "Próxima etapa"}
                    </span>
                    <ArrowRightIcon />
                  </button>
                </div>
              </div>
            </div>
            <div className="row loan-client-action-buttons">
              <button
                type="button"
                className="loan-client-modal-icon-action"
                data-tooltip="Registrar atividade"
                aria-label="Registrar atividade"
                onClick={() => {
                  setInteractionScheduledFor("");
                  setIsActivityModalOpen(true);
                }}
              >
                <ActivityIcon />
              </button>
              <button
                type="button"
                className="loan-client-modal-icon-action"
                data-tooltip="Adicionar agendamento"
                aria-label="Adicionar agendamento"
                onClick={() => {
                  setInteractionScheduledFor(getDefaultScheduleDateTimeLocal());
                  setIsScheduleModalOpen(true);
                }}
              >
                <CalendarPlusIcon />
              </button>
                <button
                  type="button"
                  className="loan-client-modal-icon-action"
                  data-tooltip="Simulador de crédito"
                  aria-label="Simulador de crédito"
                  onClick={() => onOpenSimulationModal(selectedClient)}
                >
                  <SimulatorIcon />
                </button>
            </div>
            <section className="loan-client-summary">
              <div className="section-header-row">
                <div className="section-title-with-action">
                  <h4>Resumo do Cliente</h4>
                  <button
                    type="button"
                    className="transaction-icon-button"
                    onClick={() => setIsSummaryEditing((current) => !current)}
                    title={isSummaryEditing ? "Fechar edição" : "Editar resumo"}
                    aria-label={isSummaryEditing ? "Fechar edição" : "Editar resumo"}
                  >
                    <PencilIcon />
                  </button>
                </div>
              </div>
              {isSummaryEditing ? (
                <>
                  <div className="loan-client-summary-form">
                    <label>
                      Nome
                      <input
                        value={clientSummaryForm.name}
                        onChange={(event) =>
                          setClientSummaryForm((prev) => ({ ...prev, name: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      CPF
                      <input
                        value={clientSummaryForm.cpf}
                        onChange={(event) =>
                          setClientSummaryForm((prev) => ({ ...prev, cpf: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Cidade
                      <input
                        value={clientSummaryForm.city}
                        onChange={(event) =>
                          setClientSummaryForm((prev) => ({ ...prev, city: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Profissão
                      <input
                        value={clientSummaryForm.profession}
                        onChange={(event) =>
                          setClientSummaryForm((prev) => ({ ...prev, profession: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Convênio
                      <input
                        value={clientSummaryForm.convenio}
                        onChange={(event) =>
                          setClientSummaryForm((prev) => ({ ...prev, convenio: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Renda
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={clientSummaryForm.income}
                        onChange={(event) =>
                          setClientSummaryForm((prev) => ({ ...prev, income: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Origem
                      <select
                        value={clientSummaryForm.source}
                        onChange={(event) =>
                          setClientSummaryForm((prev) => ({ ...prev, source: event.target.value }))
                        }
                      >
                        {!sourceOptions.includes(clientSummaryForm.source) && clientSummaryForm.source ? (
                          <option value={clientSummaryForm.source}>{clientSummaryForm.source}</option>
                        ) : null}
                        {sourceOptions.map((source) => (
                          <option key={`summary-source-${source}`} value={source}>
                            {source}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Telefones (separados por vírgula)
                      <input
                        value={clientSummaryForm.phones}
                        onChange={(event) =>
                          setClientSummaryForm((prev) => ({ ...prev, phones: event.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <div className="row">
                    <button type="button" className="primary-button" onClick={() => void onSaveClientSummary()}>
                      Salvar resumo
                    </button>
                  </div>
                </>
              ) : null}
              <div className="loan-client-summary-grid">
                <article>
                  <strong>Status</strong>
                  {isSummaryEditing ? (
                    <select
                      value={clientSummaryForm.status}
                      onChange={(event) =>
                        setClientSummaryForm((prev) => ({
                          ...prev,
                          status: (event.target.value || "novo") as LoanClientStatus,
                        }))
                      }
                    >
                      {statusFlow.map((status) => (
                        <option key={`summary-status-${status.key}`} value={status.key}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{statusFlow.find((item) => item.key === selectedClient.status)?.label ?? selectedClient.status}</span>
                  )}
                </article>
                <article>
                  <strong>Margem disponivel</strong>
                  {isSummaryEditing ? (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={clientSummaryForm.marginAvailable}
                      onChange={(event) =>
                        setClientSummaryForm((prev) => ({ ...prev, marginAvailable: event.target.value }))
                      }
                    />
                  ) : (
                    <span>
                      {getMargemDisponivel(selectedClient).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </span>
                  )}
                </article>
                <article>
                  <strong>SIMULACAO</strong>
                  {isSummaryEditing ? (
                    <input
                      value={clientSummaryForm.simulation}
                      onChange={(event) =>
                        setClientSummaryForm((prev) => ({ ...prev, simulation: event.target.value }))
                      }
                    />
                  ) : (
                    <span>
                      {selectedClientSummaryOverride?.simulation ||
                        (getClientQuickSimulation(selectedClient)
                          ? `${getClientQuickSimulation(selectedClient)!.installments}x de ${getClientQuickSimulation(
                              selectedClient,
                            )!.installmentValue.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}`
                          : "Sem simulação")}
                    </span>
                  )}
                </article>
                <article>
                  <strong>PRODUTO RECOMENDADO</strong>
                  {isSummaryEditing ? (
                    <input
                      value={clientSummaryForm.product}
                      onChange={(event) =>
                        setClientSummaryForm((prev) => ({ ...prev, product: event.target.value }))
                      }
                    />
                  ) : (
                    <span>{selectedClientSummaryOverride?.product || getRecommendedProduct(selectedClient)}</span>
                  )}
                </article>
                <article>
                  <strong>Nome</strong>
                  <span>{selectedClient.name || "-"}</span>
                </article>
                <article>
                  <strong>CPF</strong>
                  <span>{selectedClient.cpf || "-"}</span>
                </article>
                <article>
                  <strong>Cidade</strong>
                  <span>{selectedClient.city || "-"}</span>
                </article>
                <article>
                  <strong>Profissão</strong>
                  <span>{selectedClient.profession || "-"}</span>
                </article>
                <article>
                  <strong>Convênio</strong>
                  <span>{selectedClient.convenio || "-"}</span>
                </article>
                <article>
                  <strong>Renda</strong>
                  <span>{formatCurrency(Number(selectedClient.income || 0))}</span>
                </article>
                <article>
                  <strong>Origem</strong>
                  <span>{selectedClient.source || "-"}</span>
                </article>
                <article>
                  <strong>Telefones</strong>
                  <span>{formatPhonesDisplay(selectedClient.phones, "-")}</span>
                </article>
              </div>
            </section>
            <div className="loan-history">
              <h4>Histórico de Atividades</h4>
              {interactions.map((item) => (
                <article key={item.id}>
                  <p>{item.notes}</p>
                  <small>
                    {new Date(item.createdAt).toLocaleString("pt-BR")} - {getChannelLabel(item.channel)}
                    {item.userName ? ` - ${item.userName}` : ""}
                    {item.scheduledFor
                      ? ` - Próximo contato: ${new Date(item.scheduledFor).toLocaleString("pt-BR")}`
                      : ""}
                  </small>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {isClientDetailsModalOpen && selectedClient && isLostReasonModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-template" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h3>Motivo da perda</h3>
              <button type="button" onClick={() => setIsLostReasonModalOpen(false)}>
                X
              </button>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void onConfirmLostReason();
              }}
            >
              <label>
                Informe o motivo
                <textarea
                  rows={4}
                  value={lostReasonText}
                  onChange={(event) => setLostReasonText(event.target.value)}
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="submit" className="primary-button">
                  Confirmar perda
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {isClientDetailsModalOpen && selectedClient && isActivityModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-template" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h3>Registrar atividade</h3>
              <button type="button" onClick={() => setIsActivityModalOpen(false)}>
                X
              </button>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateInteraction({ withSchedule: false });
              }}
            >
              <label>
                Descrição
                <textarea
                  value={interactionText}
                  onChange={(event) => setInteractionText(event.target.value)}
                  rows={3}
                  required
                />
              </label>
              <label>
                Canal
                <select value={interactionChannel} onChange={(event) => setInteractionChannel(event.target.value)}>
                  {INTERACTION_CHANNEL_OPTIONS.map((option) => (
                    <option key={`activity-channel-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-actions">
                <button type="submit" className="primary-button">
                  Salvar atividade
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {isClientDetailsModalOpen && selectedClient && isScheduleModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h3>Adicionar agendamento</h3>
              <button type="button" onClick={() => setIsScheduleModalOpen(false)}>
                X
              </button>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateInteraction({ withSchedule: true });
              }}
            >
              <label>
                Descrição
                <textarea
                  value={interactionText}
                  onChange={(event) => setInteractionText(event.target.value)}
                  rows={3}
                  required
                />
              </label>
              <label>
                Canal
                <select value={interactionChannel} onChange={(event) => setInteractionChannel(event.target.value)}>
                  {INTERACTION_CHANNEL_OPTIONS.map((option) => (
                    <option key={`schedule-channel-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data e hora
                <input
                  type="datetime-local"
                  value={interactionScheduledFor}
                  onChange={(event) => setInteractionScheduledFor(event.target.value)}
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="submit" className="primary-button">
                  Salvar agendamento
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {loanSection === "agenda" ? (
        <section className="card">
          <div className="section-header-row">
            <div className="loan-agenda-title-row">
              <h3 className="loan-title-icon-label">
                <MenuAgendaIcon />
                <span>Agenda</span>
              </h3>
              <div className="loan-agenda-view-toggle" role="tablist" aria-label="Modo de visualização da agenda">
                <button
                  type="button"
                  className={agendaViewMode === "calendar" ? "active" : ""}
                  onClick={() => setAgendaViewMode("calendar")}
                >
                  Calendário
                </button>
                <button
                  type="button"
                  className={agendaViewMode === "list" ? "active" : ""}
                  onClick={() => setAgendaViewMode("list")}
                >
                  Lista
                </button>
              </div>
            </div>
            <div className="row">
              <button
                type="button"
                className="transaction-top-action transaction-top-action-new"
                onClick={() => {
                  setQuickAgendaForm((prev) => ({
                    ...prev,
                    scheduledFor: prev.scheduledFor || getDefaultScheduleDateTimeLocal(),
                  }));
                  setIsQuickAgendaModalOpen(true);
                }}
              >
                <span className="button-icon-inline">
                  <PlusIcon />
                  <span>Novo</span>
                </span>
              </button>
              <select
                value={agendaStatusFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setAgendaStatusFilter(
                    value === "pending" || value === "completed" ? value : "all",
                  );
                }}
              >
                <option value="all">Todos</option>
                <option value="pending">Pendentes</option>
                <option value="completed">Concluídos</option>
              </select>
              <select
                value={clientesFiltro.monthRef}
                onChange={(event) => {
                  setClientesFiltro((prev) => ({ ...prev, monthRef: event.target.value }));
                  setClientesPaginacao((prev) => ({ ...prev, page: 1 }));
                }}
              >
                {monthFilterOptions.map((item) => (
                  <option key={`agenda-${item.value || "all"}`} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {agendaViewMode === "calendar" ? (
            <div className="loan-agenda-calendar">
              <DragAndDropCalendar
                localizer={agendaCalendarLocalizer}
                culture="pt-BR"
                events={agendaCalendarEvents}
                views={["month", "week", "day", "agenda"]}
                defaultView="month"
                startAccessor={(event) => (event as { start: Date }).start}
                endAccessor={(event) => (event as { end: Date }).end}
                selectable
                popup
                eventPropGetter={getAgendaEventStyle}
                onSelectSlot={onSelectAgendaSlot}
                onEventDrop={onAgendaEventDrop}
                messages={{
                  today: "Hoje",
                  previous: "Anterior",
                  next: "Próximo",
                  month: "Mês",
                  week: "Semana",
                  day: "Dia",
                  agenda: "Agenda",
                  date: "Data",
                  time: "Hora",
                  event: "Evento",
                  noEventsInRange: "Nenhum agendamento neste período.",
                }}
                onSelectEvent={(event: unknown) => {
                  const item = (event as { resource?: LoanAgendaItem }).resource;
                  if (!item) return;
                  void onOpenAgendaClient(item);
                }}
              />
            </div>
          ) : null}
          {agendaViewMode === "list" ? (
            <table>
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Cliente</th>
                <th>Status</th>
                <th>Vendedor</th>
                <th>Canal</th>
                <th>Observação</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {agendaItems.length === 0 ? (
                <tr>
                  <td colSpan={8}>Nenhum contato agendado para o filtro selecionado.</td>
                </tr>
              ) : (
                agendaItems.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.scheduledFor).toLocaleString("pt-BR")}</td>
                    <td>{item.clientName}</td>
                    <td>{statusFlow.find((status) => status.key === item.status)?.label ?? item.status}</td>
                    <td>{item.assignedUserName || "-"}</td>
                    <td>{getChannelLabel(item.channel)}</td>
                    <td>{item.notes}</td>
                    <td>
                      <span className={`loan-agenda-situation-badge ${getAgendaSituationClassName(item)}`}>
                        {item.completedAt ? "Concluído" : "Pendente"}
                      </span>
                    </td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="transaction-icon-button"
                          title="Abrir cliente"
                          aria-label="Abrir cliente"
                          onClick={() => void onOpenAgendaClient(item)}
                        >
                          <OpenClientIcon />
                        </button>
                        <button
                          type="button"
                          className={`loan-agenda-action-button ${item.completedAt ? "is-done" : "is-pending"}`}
                          title={item.completedAt ? "Concluído" : "Concluir"}
                          disabled={Boolean(item.completedAt) || loadingAgendaCompleteId === item.id}
                          onClick={() => void onConcluirAgendaItem(item)}
                        >
                          {item.completedAt || loadingAgendaCompleteId === item.id ? (
                            <CheckDoneIcon />
                          ) : (
                            <CheckActionIcon />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            </table>
          ) : null}
        </section>
      ) : null}
      {loanSection === "agenda" && isQuickAgendaModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h3>Novo agendamento</h3>
              <button type="button" onClick={() => setIsQuickAgendaModalOpen(false)}>
                X
              </button>
            </div>
            <form className="modal-form" onSubmit={onCreateQuickAgenda}>
              <label>
                Cliente
                <select
                  required
                  value={quickAgendaForm.clientId}
                  onChange={(event) =>
                    setQuickAgendaForm((prev) => ({ ...prev, clientId: event.target.value }))
                  }
                >
                  <option value="">Selecione...</option>
                  {quickAgendaClients.map((client) => (
                    <option key={`quick-agenda-client-${client.id}`} value={String(client.id)}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data e hora
                <input
                  type="datetime-local"
                  required
                  value={quickAgendaForm.scheduledFor}
                  onChange={(event) =>
                    setQuickAgendaForm((prev) => ({ ...prev, scheduledFor: event.target.value }))
                  }
                />
              </label>
              <label>
                Canal
                <select
                  value={quickAgendaForm.channel}
                  onChange={(event) =>
                    setQuickAgendaForm((prev) => ({ ...prev, channel: event.target.value }))
                  }
                >
                  {INTERACTION_CHANNEL_OPTIONS.map((option) => (
                    <option key={`quick-channel-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Observação
                <textarea
                  rows={3}
                  value={quickAgendaForm.notes}
                  onChange={(event) =>
                    setQuickAgendaForm((prev) => ({ ...prev, notes: event.target.value }))
                  }
                />
              </label>
              <div className="modal-actions">
                <button type="submit" className="primary-button" disabled={isSavingQuickAgenda}>
                  {isSavingQuickAgenda ? "Salvando..." : "Salvar agendamento"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {loanSection === "importacoes" ? (
      <>
      <section className="card loan-actions-panel">
        <div className="section-header-row">
          <h3 className="loan-title-icon-label">
            <MenuImportIcon />
            <span>Importações</span>
          </h3>
        </div>
        <div className="loan-actions-row">
          <button
            className="primary-button"
            type="button"
            onClick={() => setIsImportMenuOpen((current) => !current)}
          >
            IMPORTAR
          </button>
        </div>
        {isImportMenuOpen ? (
          <div className="loan-import-options">
            <button
              type="button"
              onClick={() => {
                setIsImportModalOpen(true);
                setIsImportMenuOpen(false);
              }}
            >
              Importar leads (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => {
                setIsServidoresModalOpen(true);
                setIsImportMenuOpen(false);
              }}
            >
              Importar Portal da Transparência
            </button>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-header-row">
          <h3>Servidores importados</h3>
          <div className="row">
            <button
              type="button"
              className={servidoresFiltro.prioridadeAtendimento === "Alta" ? "primary-button" : ""}
              onClick={() => {
                setServidoresFiltro((prev) => ({
                  ...prev,
                  prioridadeAtendimento: prev.prioridadeAtendimento === "Alta" ? "" : "Alta",
                }));
                setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            >
              {servidoresFiltro.prioridadeAtendimento === "Alta"
                ? `Mostrando Alta prioridade (${servidoresPaginacao.total})`
                : "Somente Alta prioridade"}
            </button>
            <span className="loan-hint">Classificação comercial (não exclui ninguém)</span>
          </div>
        </div>
        {servidoresImportJob && servidoresImportJob.status === "running" ? (
          <div className="import-progress-wrap">
            <div className="import-progress-text">
              Importando... {servidoresImportJob.processados}/{servidoresImportJob.estimadoTotal}
            </div>
            <div className="import-progress-track">
              <div className="import-progress-fill" style={{ width: `${progressoImportacaoPercentual}%` }} />
            </div>
          </div>
        ) : null}
        <div className="loan-filter-row">
          <input
            placeholder="Buscar por nome"
            value={servidoresFiltro.nome}
            onChange={(event) => {
              setServidoresFiltro((prev) => ({
                ...prev,
                nome: event.target.value,
              }));
              setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          />
          <div className="rubrica-combobox">
            <input
              placeholder="Rubrica desconto"
              value={servidoresFiltro.rubrica}
              onFocus={() => setRubricaDropdownOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setRubricaDropdownOpen(false), 120);
              }}
              onChange={(event) => {
                setServidoresFiltro((prev) => ({
                  ...prev,
                  rubrica: event.target.value,
                }));
                setRubricaDropdownOpen(true);
                setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            />
            {rubricaDropdownOpen ? (
              <div className="rubrica-combobox-list">
                <button
                  type="button"
                  className="rubrica-combobox-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setServidoresFiltro((prev) => ({ ...prev, rubrica: "" }));
                    setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
                    setRubricaDropdownOpen(false);
                  }}
                >
                  <span>Todas rubricas de desconto</span>
                </button>
                {rubricasDescontoFiltradas.length === 0 ? (
                  <div className="rubrica-combobox-empty">Nenhuma rubrica encontrada.</div>
                ) : (
                  rubricasDescontoFiltradas.map((rubrica) => (
                    <button
                      key={rubrica.nome}
                      type="button"
                      className="rubrica-combobox-item"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setServidoresFiltro((prev) => ({
                          ...prev,
                          rubrica: rubrica.nome,
                        }));
                        setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
                        setRubricaDropdownOpen(false);
                      }}
                    >
                      <span>
                        {(() => {
                          if (!rubricaBuscaTermo) return rubrica.nome;
                          const idx = rubrica.nome.indexOf(rubricaBuscaTermo);
                          if (idx < 0) return rubrica.nome;
                          const before = rubrica.nome.slice(0, idx);
                          const match = rubrica.nome.slice(idx, idx + rubricaBuscaTermo.length);
                          const after = rubrica.nome.slice(idx + rubricaBuscaTermo.length);
                          return (
                            <>
                              {before}
                              <mark className="rubrica-highlight">{match}</mark>
                              {after}
                            </>
                          );
                        })()}
                      </span>
                      <small>{rubrica.total}</small>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <input
            type="number"
            min={2000}
            max={2100}
            placeholder="Ano"
            value={servidoresFiltro.ano}
            onChange={(event) => {
              setServidoresFiltro((prev) => ({
                ...prev,
                ano: event.target.value,
              }));
              setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          />
          <input
            type="number"
            min={1}
            max={12}
            placeholder="Mes"
            value={servidoresFiltro.mes}
            onChange={(event) => {
              setServidoresFiltro((prev) => ({
                ...prev,
                mes: event.target.value,
              }));
              setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          />
          <select
            value={servidoresFiltro.classificacao}
            onChange={(event) => {
              setServidoresFiltro((prev) => ({
                ...prev,
                classificacao: event.target.value,
              }));
              setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="">Todas classificações</option>
            <option value="Com consignado">Com consignado</option>
            <option value="Sem consignado">Sem consignado</option>
          </select>
          <select
            value={servidoresFiltro.classificacaoMargem}
            onChange={(event) => {
              setServidoresFiltro((prev) => ({
                ...prev,
                classificacaoMargem: event.target.value,
              }));
              setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="">Toda margem</option>
            <option value="Alta">Margem alta</option>
            <option value="Media">Margem media</option>
            <option value="Baixa">Margem baixa</option>
          </select>
          <select
            value={servidoresFiltro.classificacaoScore}
            onChange={(event) => {
              setServidoresFiltro((prev) => ({
                ...prev,
                classificacaoScore: event.target.value,
              }));
              setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="">Todo score</option>
            <option value="Quente">🔥 Quente</option>
            <option value="Morno">🟡 Morno</option>
            <option value="Frio">❄ Frio</option>
          </select>
          <select
            value={servidoresFiltro.prioridadeAtendimento}
            onChange={(event) => {
              setServidoresFiltro((prev) => ({
                ...prev,
                prioridadeAtendimento: event.target.value,
              }));
              setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="">Toda prioridade</option>
            <option value="Alta">🔥 Alta</option>
            <option value="Media">🟡 Media</option>
            <option value="Baixa">❄ Baixa</option>
          </select>
          <select
            value={String(servidoresPaginacao.pageSize)}
            onChange={(event) =>
              setServidoresPaginacao((prev) => ({
                ...prev,
                page: 1,
                pageSize: Number(event.target.value || 10),
              }))
            }
          >
            <option value="10">10 por página</option>
            <option value="25">25 por página</option>
            <option value="50">50 por página</option>
            <option value="100">100 por página</option>
            <option value="200">200 por página</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setServidoresFiltro({
                nome: "",
                rubrica: "",
                ano: "",
                mes: "",
                classificacao: "",
                classificacaoMargem: "",
                classificacaoScore: "",
                prioridadeAtendimento: "",
              });
              setServidoresPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            Limpar
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Ações</th>
              <th>Nome</th>
              <th>Liberado</th>
              <th>Parcela</th>
              <th>Prazo</th>
              <th>Produto</th>
              <th>Prioridade</th>
              <th>Cadastrar</th>
            </tr>
          </thead>
          <tbody>
            {servidoresImportados.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  {servidoresLoading ? "Carregando servidores..." : "Nenhum servidor encontrado para o filtro."}
                </td>
              </tr>
            ) : (
              servidoresImportados.map((item) => {
                const expandido = servidoresExpandidos.includes(item.id);
                return (
                  <Fragment key={item.id}>
                    <tr>
                      <td>
                        <div className="row">
                          <button type="button" onClick={() => toggleServidorDetalhes(item.id)}>
                            {expandido ? "-" : "+"}
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => void onSimularServidorAgora(item.id)}
                            disabled={simulandoServidorId === item.id}
                          >
                            {simulandoServidorId === item.id ? "Simulando..." : "Simular agora"}
                          </button>
                          {simulacoesRecentesIds.includes(item.id) ? (
                            <span className="simulacao-ok-badge" title="Simulado agora" aria-label="Simulado agora">
                              ✓
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>{item.name}</td>
                      <td>{formatCurrency(item.valorMaximoLiberado)}</td>
                      <td>{formatCurrency(item.melhorParcela)}</td>
                      <td>{item.melhorPrazo}x</td>
                      <td>{item.produtoRecomendado || "-"}</td>
                      <td>{prioridadeBadge(item.prioridadeAtendimento)}</td>
                      <td>
                        <button type="button" onClick={() => onCadastrarServidor(item)}>
                          Cadastrar
                        </button>
                      </td>
                    </tr>
                    {expandido ? (
                      <tr className="details-row">
                        <td colSpan={8}>
                          <div className="details-grid">
                            <div className="detail-item">
                              <strong>Score e prioridade</strong>
                              <span>
                                {item.score} - {scoreBadge(item.classificacaoScore)} - {prioridadeBadge(item.prioridadeAtendimento)}
                              </span>
                            </div>
                            <div className="detail-item">
                              <strong>Produto recomendado</strong>
                              <span>{item.produtoRecomendado || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Motivo da recomendacao</strong>
                              <span>{item.motivoRecomendacao || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Regime de contratacao</strong>
                              <span>{item.regime || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Vinculo</strong>
                              <span>{item.vinculo || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Lotacao</strong>
                              <span>{item.lotacao || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Admissao</strong>
                              <span>{item.dataAdmissao || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Margem maxima</strong>
                              <span>{formatCurrency(item.margemMaxima)}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Margem utilizada</strong>
                              <span>{formatCurrency(item.margemUtilizada)}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Margem disponivel</strong>
                              <span>{formatCurrency(item.margemDisponivel)}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Classificação de margem</strong>
                              <span>{item.classificacaoMargem}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Total pago</strong>
                              <span>{formatCurrency(item.totalPago)}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Classificação consignado</strong>
                              <span>{item.classificacaoConsignado}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Periodo de folha</strong>
                              <span>
                                {String(item.mes).padStart(2, "0")}/{item.ano}
                              </span>
                            </div>
                            <div className="detail-item detail-item-rubricas">
                              <strong>Rubricas</strong>
                              {item.rubricas && item.rubricas.length > 0 ? (
                                <div className="rubricas-list">
                                  {item.rubricas.slice(0, 12).map((rubrica, index) => (
                                    <div key={`${item.id}-${rubrica.nome}-${index}`} className="rubrica-item">
                                      <span className="rubrica-name">{rubrica.nome}</span>
                                      <span className="rubrica-value">{formatCurrency(rubrica.valor)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span>-</span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
        <div className="loan-pagination-row">
          <span className="loan-hint">
            {servidoresPaginacao.total} registros - página {servidoresPaginacao.page} de{" "}
            {servidoresPaginacao.totalPages}
          </span>
          <div className="row">
            <button
              type="button"
              disabled={servidoresPaginacao.page <= 1 || servidoresLoading}
              onClick={() =>
                setServidoresPaginacao((prev) => ({
                  ...prev,
                  page: Math.max(1, prev.page - 1),
                }))
              }
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={
                servidoresPaginacao.page >= servidoresPaginacao.totalPages || servidoresLoading
              }
              onClick={() =>
                setServidoresPaginacao((prev) => ({
                  ...prev,
                  page: Math.min(prev.totalPages, prev.page + 1),
                }))
              }
            >
              Próxima
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Produtos financeiros</h3>
        {isAdmin ? (
          <form className="loan-product-form" onSubmit={onCreateProduct}>
            <input
              placeholder="Nome"
              value={productForm.name}
              onChange={(event) => setProductForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <select
              value={productForm.productType}
              onChange={(event) =>
                setProductForm((prev) => ({
                  ...prev,
                  productType: event.target.value as LoanProductType,
                }))
              }
            >
              <option value="credito">Crédito</option>
              <option value="seguros">Seguros</option>
              <option value="capitalizacao">Capitalizacao</option>
              <option value="imobiliario">Imobiliario</option>
            </select>
            <input
              type="number"
              step="0.01"
              placeholder="Taxa padrao"
              value={productForm.defaultRate}
              onChange={(event) =>
                setProductForm((prev) => ({ ...prev, defaultRate: event.target.value }))
              }
              required
            />
            <input
              type="number"
              placeholder="Prazo min"
              value={productForm.minTerm}
              onChange={(event) => setProductForm((prev) => ({ ...prev, minTerm: event.target.value }))}
              required
            />
            <input
              type="number"
              placeholder="Prazo max"
              value={productForm.maxTerm}
              onChange={(event) => setProductForm((prev) => ({ ...prev, maxTerm: event.target.value }))}
              required
            />
            <button className="primary-button" type="submit">
              Criar produto
            </button>
          </form>
        ) : null}

        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Taxa</th>
              <th>Prazo</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.productType}</td>
                <td>{Number(item.defaultRate).toFixed(2)}%</td>
                <td>
                  {item.minTerm} a {item.maxTerm}
                </td>
                <td>{item.active ? "Ativo" : "Inativo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      </>
      ) : null}

      {isTemplateModalOpen && templateClient ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Enviar template WhatsApp</h2>
              <button type="button" onClick={() => setIsTemplateModalOpen(false)}>
                X
              </button>
            </div>
            <p className="section-subtitle">
              Cliente: {templateClient.name} | Telefone:{" "}
              {formatPhonesDisplay(templateClient.phones, "Sem telefone")}
            </p>
            <div className="loan-template-select-row">
              <label>
                Template
                <select
                  value={selectedTemplateBase}
                  onChange={(event) => {
                    const baseTemplate = event.target.value || templateLibrary[0] || DEFAULT_MESSAGE_TEMPLATES[0];
                    setSelectedTemplateBase(baseTemplate);
                    setTemplateText(applyTemplateTags(baseTemplate, templateClient));
                  }}
                >
                  {templateLibrary.map((template) => (
                    <option key={template} value={template}>
                      {template}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="transaction-top-action transaction-top-action-new loan-template-new-button"
                onClick={onOpenTemplateManagerModal}
              >
                <span className="button-icon-inline">
                  <PlusIcon />
                  <span>Novo</span>
                </span>
              </button>
            </div>
            <label>
              Mensagem final (prévia)
              <textarea
                rows={4}
                value={templateText}
                readOnly
              />
            </label>
            <div className="row">
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  openWhatsAppForClient(templateClient, applyTemplateTags(templateText, templateClient));
                  setIsTemplateModalOpen(false);
                }}
              >
                Abrir WhatsApp Web
              </button>
              <button type="button" onClick={() => setIsTemplateModalOpen(false)}>
                Cancelar
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isTemplateManagerModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-template" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Novo template WhatsApp</h2>
              <button type="button" onClick={() => setIsTemplateManagerModalOpen(false)}>
                X
              </button>
            </div>
            <p className="section-subtitle">
              Use os botões de ação para editar ou excluir o template selecionado.
            </p>
            <label>
              Conteúdo do template
              <textarea
                rows={3}
                placeholder="Ex.: {saudacao}, {nome}! Tenho uma condição especial para {convenio}."
                value={newTemplateDraft}
                ref={templateDraftTextareaRef}
                onChange={(event) => setNewTemplateDraft(event.target.value)}
              />
            </label>
            <label>
              Prévia com tags aplicadas
              <textarea rows={3} value={templateManagerPreviewText} readOnly />
            </label>
            <div className="loan-template-actions-row">
              <button
                type="button"
                className="transaction-icon-button"
                onClick={onEditSelectedTemplate}
                disabled={isDefaultTemplate(selectedTemplateBase)}
                title="Editar template selecionado"
                aria-label="Editar template selecionado"
              >
                <EditIcon />
              </button>
              <button
                type="button"
                className="transaction-icon-button danger"
                onClick={onRemoveSelectedTemplate}
                disabled={isDefaultTemplate(selectedTemplateBase)}
                title="Excluir template selecionado"
                aria-label="Excluir template selecionado"
              >
                <TrashIcon />
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={onSaveTemplate}
                disabled={!newTemplateDraft.trim()}
              >
                {isEditingTemplate ? "Salvar edição" : "Salvar template"}
              </button>
            </div>
            <div className="loan-template-tags-info">
              <strong>Tags disponíveis (clique para inserir)</strong>
              <div className="loan-template-tags-grid">
                {TEMPLATE_TAGS_HELP.map((tag) => (
                  <button
                    key={tag.key}
                    type="button"
                    className="loan-template-tag-item"
                    onClick={() => onInsertTemplateTag(tag.key)}
                    title="Clique para inserir a tag no conteúdo"
                  >
                    <code>{tag.key}</code>
                    <span>{tag.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isSimulationModalOpen && simClient ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-simulation" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Simulador de crédito</h2>
              <button type="button" onClick={() => setIsSimulationModalOpen(false)}>
                X
              </button>
            </div>
            <p className="section-subtitle">Cliente: {simClient.name}</p>
            <form className="form-stack" onSubmit={onCreateSimulation}>
              <label>
                Produto
                <select value={simForm.productId} onChange={onProductSelect}>
                  <option value="">Selecione</option>
                  {products
                    .filter((item) => item.active)
                    .map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.name} ({item.productType})
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Tipo
                <select
                  value={simForm.productType}
                  onChange={(event) =>
                    setSimForm((prev) => ({ ...prev, productType: event.target.value as LoanProductType }))
                  }
                >
                  <option value="credito">Crédito</option>
                  <option value="seguros">Seguros</option>
                  <option value="capitalizacao">Capitalizacao</option>
                  <option value="imobiliario">Imobiliario</option>
                </select>
              </label>
              <label>
                Valor desejado
                <input
                  type="number"
                  step="0.01"
                  value={simForm.principal}
                  onChange={(event) => setSimForm((prev) => ({ ...prev, principal: event.target.value }))}
                  required
                />
              </label>
              <label>
                Parcelas
                <input
                  type="number"
                  value={simForm.installments}
                  onChange={(event) => setSimForm((prev) => ({ ...prev, installments: event.target.value }))}
                  required
                />
              </label>
              <label>
                Taxa mensal (%)
                <input
                  type="number"
                  step="0.01"
                  value={simForm.monthlyRate}
                  onChange={(event) => setSimForm((prev) => ({ ...prev, monthlyRate: event.target.value }))}
                  required
                />
              </label>
              <button className="primary-button" type="submit">
                Salvar simulação
              </button>
            </form>

            <div className="loan-sim-grid">
              {simulations.map((item) => (
                <article key={item.id} className={item.isBest ? "best" : ""}>
                  <strong>{item.productType}</strong>
                  <span>Parcela: R$ {Number(item.installmentValue).toFixed(2)}</span>
                  <span>Total: R$ {Number(item.totalPaid).toFixed(2)}</span>
                  <span>Custo: R$ {Number(item.effectiveCost).toFixed(2)}</span>
                  {item.isBest ? <small>Melhor opcao</small> : null}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {isClientModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-client-form" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>{editingClientId ? "Editar cliente" : "Novo cliente"}</h2>
              <button
                type="button"
                onClick={() => {
                  setEditingClientId(null);
                  setIsClientModalOpen(false);
                  setIsSellerModalOpen(false);
                }}
              >
                X
              </button>
            </div>
            <form className="form-stack" onSubmit={onCreateClient}>
              <label>
                Nome
                <input
                  value={clientForm.name}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </label>
              <label>
                CPF
                <input
                  value={clientForm.cpf}
                  onChange={(event) =>
                    setClientForm((prev) => ({ ...prev, cpf: formatCpf(event.target.value) }))
                  }
                  required
                />
              </label>
              <label>
                Telefone
                <div className="phone-fields-list">
                  {clientForm.phones.map((phone, index) => (
                    <div key={index} className="phone-field-row">
                      <input
                        value={phone}
                        onChange={(event) =>
                          setClientForm((prev) => {
                            const nextPhones = [...prev.phones];
                            nextPhones[index] = formatPhone(event.target.value);
                            return {
                              ...prev,
                              phones: nextPhones,
                            };
                          })
                        }
                        required={index === 0}
                        placeholder={`Telefone ${index + 1}`}
                      />
                      <button
                        type="button"
                        className="lead-source-add-button"
                        onClick={() =>
                          setClientForm((prev) => ({
                            ...prev,
                            phones: [...prev.phones, ""],
                          }))
                        }
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </label>
              <label>
                Cidade
                <input
                  value={clientForm.city}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, city: event.target.value }))}
                />
              </label>
              <label>
                Profissão
                <input
                  value={clientForm.profession}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, profession: event.target.value }))}
                />
              </label>
              <label>
                Renda
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={clientForm.income}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, income: event.target.value }))}
                />
              </label>
              <label>
                Vendedor
                <div className="lead-source-row">
                  <select
                    value={String(clientForm.assignedUserId || "")}
                    onChange={(event) => {
                      const sellerId = Number(event.target.value || 0);
                      const seller = sellerOptions.find((item) => item.id === sellerId);
                      setClientForm((prev) => ({
                        ...prev,
                        assignedUserId: sellerId,
                        assignedUserName: seller?.name ?? prev.assignedUserName,
                      }));
                    }}
                    required
                  >
                    {sellerOptions.map((seller) => (
                      <option key={seller.id} value={String(seller.id)}>
                        {seller.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="lead-source-add-button"
                    title="Selecionar vendedor"
                    onClick={() => setIsSellerModalOpen(true)}
                  >
                    ...
                  </button>
                </div>
              </label>
              <label>
                Origem do lead
                <div className="lead-source-row">
                  <select
                    value={clientForm.source}
                    onChange={(event) => setClientForm((prev) => ({ ...prev, source: event.target.value }))}
                    required
                  >
                    {sourceOptions.map((source) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="lead-source-add-button" onClick={onAddLeadSourceOption}>
                    +
                  </button>
                </div>
              </label>
              <label>
                Convênio
                <div className="lead-source-row">
                  <select
                    value={clientForm.convenio}
                    onChange={(event) => setClientForm((prev) => ({ ...prev, convenio: event.target.value }))}
                  >
                    {convenioOptions.map((convenio) => (
                      <option key={convenio} value={convenio}>
                        {convenio}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="lead-source-add-button" onClick={onAddConvenioOption}>
                    +
                  </button>
                </div>
              </label>
              <div className="row">
                <button className="primary-button" type="submit">
                  {editingClientId ? "Salvar alterações" : "Salvar cliente"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingClientId(null);
                    setIsClientModalOpen(false);
                    setIsSellerModalOpen(false);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isSellerModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-seller" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Selecionar vendedor</h2>
              <button type="button" onClick={() => setIsSellerModalOpen(false)}>
                X
              </button>
            </div>
            <div className="seller-list">
              {sellerOptions.length === 0 ? (
                <p>Nenhum vendedor ativo encontrado.</p>
              ) : (
                sellerOptions.map((seller) => (
                  <button
                    key={seller.id}
                    type="button"
                    className={`seller-item ${clientForm.assignedUserId === seller.id ? "selected" : ""}`}
                    onClick={() => {
                      setClientForm((prev) => ({
                        ...prev,
                        assignedUserId: seller.id,
                        assignedUserName: seller.name,
                      }));
                      setIsSellerModalOpen(false);
                    }}
                  >
                    <strong>{seller.name}</strong>
                    <small>{seller.email}</small>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isImportModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-import-leads" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Importacao de leads (.xlsx)</h2>
              <button type="button" onClick={() => setIsImportModalOpen(false)}>
                X
              </button>
            </div>
            <label>
              Arquivo Excel
              <input type="file" accept=".xlsx,.xls" onChange={onImportFile} />
            </label>
            <label>
              Origem padrao
              <input value={importSource} onChange={(event) => setImportSource(event.target.value)} />
            </label>

            {importHeaders.length > 0 ? (
              <div className="loan-import-mapper">
                <p>Mapeamento de colunas</p>
                {(
                  [
                    ["name", "Nome"],
                    ["cpf", "CPF"],
                    ["phone", "Telefone"],
                    ["city", "Cidade"],
                    ["profession", "Profissão"],
                    ["convenio", "Convênio"],
                    ["income", "Renda"],
                    ["source", "Origem"],
                  ] as Array<[keyof ImportFieldMap, string]>
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <select
                      value={importMap[key]}
                      onChange={(event) =>
                        setImportMap((prev) => ({
                          ...prev,
                          [key]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Selecione</option>
                      {importHeaders.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <div className="row">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={onImportLeads}
                    disabled={leadImportProgress?.running}
                  >
                    {leadImportProgress?.running ? "Importando..." : "Importar leads"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(false)}
                    disabled={leadImportProgress?.running}
                  >
                    Cancelar
                  </button>
                </div>
                <small>
                  Preview de {importPreview.length} linhas. Importados na ultima execucao: {importPreviewCount}
                </small>
                {leadImportProgress ? (
                  <div className="import-progress-wrap">
                    <div className="import-progress-text">
                      Importando leads... {leadImportProgress.processed}/{leadImportProgress.total} | Importados:{" "}
                      {leadImportProgress.imported} | Duplicados: {leadImportProgress.duplicates}
                    </div>
                    <div className="import-progress-track">
                      <div
                        className="import-progress-fill"
                        style={{ width: `${progressoImportacaoLeadsPercentual}%` }}
                      />
                    </div>
                    {leadImportProgress.running ? (
                      <div className="row">
                        <button
                          type="button"
                          onClick={() => {
                            leadImportCancelRef.current = true;
                            setIsCancellingLeadImport(true);
                          }}
                          disabled={isCancellingLeadImport}
                        >
                          {isCancellingLeadImport ? "Parando..." : "Parar importação"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {importPreview.length > 0 ? (
                  <div className="loan-import-preview">
                    <table>
                      <thead>
                        <tr>
                          <th>Nome</th>
                          <th>CPF</th>
                          <th>Telefone</th>
                          <th>Cidade</th>
                          <th>Profissão</th>
                          <th>Convênio</th>
                          <th>Renda</th>
                          <th>Origem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((item, index) => (
                          <tr key={`${item.cpf}-${index}`}>
                            <td>{item.name || "-"}</td>
                            <td>{item.cpf || "-"}</td>
                            <td>{formatPhonesDisplay(item.phones, "-")}</td>
                            <td>{item.city || "-"}</td>
                            <td>{item.profession || "-"}</td>
                            <td>{item.convenio || "INSS"}</td>
                            <td>{formatCurrency(Number(item.income || 0))}</td>
                            <td>{item.source || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {isServidoresModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-import-public" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Importar servidores</h2>
              <button type="button" onClick={() => setIsServidoresModalOpen(false)}>
                X
              </button>
            </div>
            <form className="form-stack" onSubmit={onImportarServidores}>
              <label>
                Nome (opcional para filtrar e acelerar)
                <input
                  value={servidoresForm.nome}
                  onChange={(event) =>
                    setServidoresForm((prev) => ({
                      ...prev,
                      nome: event.target.value,
                    }))
                  }
                  placeholder="Ex.: joana"
                />
              </label>
              <label>
                Ano
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={servidoresForm.ano}
                  onChange={(event) =>
                    setServidoresForm((prev) => ({
                      ...prev,
                      ano: Number(event.target.value || new Date().getFullYear()),
                    }))
                  }
                />
              </label>
              <label>
                Mes
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={servidoresForm.mes}
                  onChange={(event) =>
                    setServidoresForm((prev) => ({
                      ...prev,
                      mes: Number(event.target.value || 1),
                    }))
                  }
                />
              </label>
              <label>
                Tamanho por página
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={servidoresForm.tamanho}
                  onChange={(event) =>
                    setServidoresForm((prev) => ({
                      ...prev,
                      tamanho: Number(event.target.value || 50),
                    }))
                  }
                />
              </label>
              <label>
                Máximo de páginas
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={servidoresForm.maxPaginas}
                  onChange={(event) =>
                    setServidoresForm((prev) => ({
                      ...prev,
                      maxPaginas: Number(event.target.value || 10),
                    }))
                  }
                />
              </label>
              <div className="row">
                <button className="primary-button" type="submit" disabled={isImportandoServidores}>
                  {isImportandoServidores ? "Importando..." : "Executar importação"}
                </button>
                <button type="button" onClick={() => setIsServidoresModalOpen(false)}>
                  Cancelar
                </button>
              </div>
            </form>
            {servidoresResultado ? (
              <p className="copy-feedback">
                {servidoresResultado.importados} servidores importados |{" "}
                {servidoresResultado.comConsignado} com consignado |{" "}
                {servidoresResultado.semConsignado} sem consignado
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {loanSection === "comissao" ? (
        <section className="card">
          <div className="section-header-row">
            <h3 className="loan-title-icon-label">
              <MenuComissaoIcon />
              <span>Comissões</span>
            </h3>
          </div>
          <p className="section-subtitle">Módulo reservado para implementação futura.</p>
        </section>
      ) : null}

      {message ? (
        <div className={`floating-feedback floating-feedback-${feedbackTone}`}>
          <span>{`${feedbackTone === "success" ? "Sucesso" : feedbackTone === "error" ? "Erro" : "Aviso"}: ${message}`}</span>
          <button type="button" onClick={() => setMessage("")}>
            X
          </button>
        </div>
      ) : null}
    </div>
  );
}
