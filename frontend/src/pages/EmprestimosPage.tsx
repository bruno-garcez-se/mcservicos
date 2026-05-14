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
  createLoanPipelineStage,
  deleteLoanPipelineStage,
  deleteLoanClient,
  completeLoanAgendaItem,
  getLoanClientById,
  getLoanDashboard,
  getLoanFunnelOutcomeReport,
  getLoanSettings,
  getProgressoImportacaoServidores,
  importarServidoresPortal,
  importLoanLeads,
  listLoanAgenda,
  listLoanConvenios,
  listServidoresImportados,
  listRubricasDescontoServidores,
  listLoanSellers,
  listLoanPipelineStages,
  listLoanClients,
  listLoanOpportunities,
  listLoanTimeline,
  listLoanProducts,
  listLoanSimulations,
  markLoanClientActivityTouch,
  updateLoanClient,
  updateLoanClientHeatBadge,
  updateLoanClientLossMargin,
  updateLoanOpportunityCommissionData,
  updateLoanSettings,
  updateLoanClientStatus,
  updateLoanPipelineStages,
  rescheduleLoanAgendaItem,
} from "../services/loansApi";
import {
  ImportedServant,
  LoanAgendaItem,
  LoanClient,
  LoanClientStatus,
  LoanFunnelOutcomeReport,
  LoanOpportunity,
  LoanPipelineStage,
  LoanTimelineItem,
  LoanProductType,
} from "../types";

type NegocialSectionVisibility = {
  cadastro: boolean;
  funil: boolean;
  agenda: boolean;
  importacoes: boolean;
  comissao: boolean;
  relatorios: boolean;
};

const DEFAULT_NEGOCIAL_SECTION_VISIBILITY: NegocialSectionVisibility = {
  cadastro: true,
  funil: true,
  agenda: true,
  importacoes: true,
  comissao: true,
  relatorios: true,
};

const DEFAULT_STATUS_FLOW: Array<{ key: LoanClientStatus; label: string }> = [
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
const TERMINAL_FUNNEL_STATUS = new Set<LoanClientStatus>(["ganho", "perdido"]);
const EMPTY_KANBAN_TOTALS = DEFAULT_STATUS_FLOW.reduce(
  (acc, item) => ({ ...acc, [item.key]: 0 }),
  {} as Record<string, number>,
);
const EMPTY_KANBAN_CARDS = DEFAULT_STATUS_FLOW.reduce(
  (acc, item) => ({ ...acc, [item.key]: [] as LoanClient[] }),
  {} as Record<string, LoanClient[]>,
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
type CommissionDraft = {
  manualMargin: string;
  contractValue: string;
  netValue: string;
  termMonths: string;
  interestRate: string;
  agency: string;
  contractType: string;
  pdv: string;
  assignedUserId: string;
  commissionStatus: "pendente" | "pago";
  notes: string;
};

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

function formatCep(value: string): string {
  const digits = onlyDigits(value).slice(0, 8);
  if (!digits) return "";
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function formatCurrencyInput(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return "";
  const amount = Number(digits) / 100;
  return amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function normalizeCurrencyInput(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return "";
  const amount = Number(digits) / 100;
  return amount.toFixed(2);
}

function parseLocaleNumber(value: string): number | null {
  const raw = value.trim().replace(/\s/g, "").replace("R$", "");
  if (!raw) return null;

  const onlyNumberChars = raw.replace(/[^\d,.-]/g, "");
  if (!onlyNumberChars) return null;

  const lastComma = onlyNumberChars.lastIndexOf(",");
  const lastDot = onlyNumberChars.lastIndexOf(".");
  let normalized = onlyNumberChars;

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = onlyNumberChars.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = onlyNumberChars.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    normalized = onlyNumberChars.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(onlyNumberChars)) {
    normalized = onlyNumberChars.replace(/\./g, "");
  } else {
    normalized = onlyNumberChars.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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

function CycleHistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 4a8 8 0 1 1-7.75 10h2.06a6 6 0 1 0 1.9-6.14l1.79 1.79H5V5l1.83 1.83A7.96 7.96 0 0 1 12 4Zm-.75 4a1 1 0 1 1 2 0v3.38l2.45 1.42a1 1 0 0 1-1 1.74l-2.95-1.7a1 1 0 0 1-.5-.87V8Z"
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

function MenuRelatoriosIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.4a2 2 0 0 0-.58-1.41l-3.4-3.41A2 2 0 0 0 15.6 4H5Zm10 .6V7a1 1 0 0 0 1 1h3.4L15 3.6Zm-7 7.4a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H9a1 1 0 0 1-1-1Zm0 4a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H9a1 1 0 0 1-1-1Zm0 4a1 1 0 0 1 1-1h3a1 1 0 1 1 0 2H9a1 1 0 0 1-1-1Z"
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

export function EmprestimosPage(props: { sectionVisibility?: NegocialSectionVisibility }) {
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
  const [timelineItems, setTimelineItems] = useState<LoanTimelineItem[]>([]);
  const [opportunities, setOpportunities] = useState<LoanOpportunity[]>([]);
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
  const [selectedAgendaItem, setSelectedAgendaItem] = useState<LoanAgendaItem | null>(null);
  const [quickAgendaClientQuery, setQuickAgendaClientQuery] = useState("");
  const [quickAgendaClientResults, setQuickAgendaClientResults] = useState<LoanClient[]>([]);
  const [isQuickAgendaClientDropdownOpen, setIsQuickAgendaClientDropdownOpen] = useState(false);
  const [isLoadingQuickAgendaClients, setIsLoadingQuickAgendaClients] = useState(false);
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
  const resolvedSectionVisibility = {
    ...DEFAULT_NEGOCIAL_SECTION_VISIBILITY,
    ...(props.sectionVisibility ?? {}),
  };
  const availableSections = (
    ["cadastro", "funil", "agenda", "importacoes", "comissao", "relatorios"] as const
  ).filter((section) => resolvedSectionVisibility[section]);
  const defaultSection = (availableSections[0] ?? "funil") as
    | "cadastro"
    | "funil"
    | "agenda"
    | "importacoes"
    | "comissao"
    | "relatorios";
  const [loanSection, setLoanSection] = useState<
    "cadastro" | "funil" | "agenda" | "importacoes" | "comissao" | "relatorios"
  >(defaultSection);
  const [pipelineStages, setPipelineStages] = useState<LoanPipelineStage[]>([]);
  const [isStageConfigOpen, setIsStageConfigOpen] = useState(false);
  const [isLoanSettingsModalOpen, setIsLoanSettingsModalOpen] = useState(false);
  const [stageConfigItems, setStageConfigItems] = useState<Array<{ key: string; label: string; active: boolean }>>([]);
  const [newStageLabel, setNewStageLabel] = useState("");
  const [isSavingStageConfig, setIsSavingStageConfig] = useState(false);
  const statusFlow = useMemo(() => {
    const activeStages = pipelineStages
      .filter((item) => item.active)
      .sort((a, b) => a.position - b.position)
      .map((item) => ({ key: item.key as LoanClientStatus, label: item.label }));
    return activeStages.length > 0 ? activeStages : DEFAULT_STATUS_FLOW;
  }, [pipelineStages]);

  useEffect(() => {
    if (!resolvedSectionVisibility[loanSection]) {
      setLoanSection(defaultSection);
    }
  }, [
    defaultSection,
    loanSection,
    resolvedSectionVisibility.agenda,
    resolvedSectionVisibility.cadastro,
    resolvedSectionVisibility.comissao,
    resolvedSectionVisibility.funil,
    resolvedSectionVisibility.importacoes,
    resolvedSectionVisibility.relatorios,
  ]);

  const [clientForm, setClientForm] = useState({
    name: "",
    cpf: "",
    phones: [""],
    cep: "",
    addressStreet: "",
    addressNumber: "",
    addressComplement: "",
    addressNeighborhood: "",
    city: "",
    addressState: "",
    profession: "",
    convenio: "",
    income: "0",
    heatBadge: null as "Quente" | "Morno" | "Frio" | null,
    source: "manual",
    status: "novo" as LoanClientStatus,
    assignedUserId: user?.id ?? 0,
    assignedUserName: user?.name ?? "",
  });
  const [sellerOptions, setSellerOptions] = useState<Array<{ id: number; name: string; email: string }>>([]);
  const [isSellerModalOpen, setIsSellerModalOpen] = useState(false);
  const [isLoadingCep, setIsLoadingCep] = useState(false);
  const [cepLookupMessage, setCepLookupMessage] = useState("");
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
  const [isCycleHistoryModalOpen, setIsCycleHistoryModalOpen] = useState(false);
  const [isHeatBadgeMenuOpen, setIsHeatBadgeMenuOpen] = useState(false);
  const [isLostReasonModalOpen, setIsLostReasonModalOpen] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<
    "all" | "activity" | "status" | "agenda" | "simulation" | "loss" | "client" | "event"
  >("all");
  const [lostReasonText, setLostReasonText] = useState("");
  const [lostHasMargin, setLostHasMargin] = useState<"" | "sim" | "nao">("");
  const [isSummaryEditing, setIsSummaryEditing] = useState(false);
  const [summaryOverrides, setSummaryOverrides] = useState<
    Record<
      number,
      {
        contractValue: string;
        netValue: string;
        termMonths: string;
        interestRate: string;
        agency: string;
        convenio: string;
        contractType: string;
        pdv: string;
        seguro: string;
      }
    >
  >(() => {
    try {
      const raw = localStorage.getItem("loan:summary-overrides");
      if (!raw) return {};
      return JSON.parse(raw) as Record<
        number,
        {
          contractValue: string;
          netValue: string;
          termMonths: string;
          interestRate: string;
          agency: string;
          convenio: string;
          contractType: string;
          pdv: string;
          seguro: string;
        }
      >;
    } catch {
      return {};
    }
  });
  const [whatsMenuClientId, setWhatsMenuClientId] = useState<number | null>(null);
  const [clientSummaryForm, setClientSummaryForm] = useState({
    contractValue: "",
    netValue: "",
    termMonths: "",
    interestRate: "",
    agency: "",
    convenio: "",
    contractType: "",
    pdv: "",
    seguro: "",
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
  const [convenioCatalog, setConvenioCatalog] = useState<string[]>([]);
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
          source: "",
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
        source?: string;
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
        source: typeof parsed.source === "string" ? parsed.source : "",
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
        source: "",
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
  const [kanbanColumnTotals, setKanbanColumnTotals] = useState<Record<string, number>>(EMPTY_KANBAN_TOTALS);
  const [kanbanCardsByStatus, setKanbanCardsByStatus] = useState<Record<string, LoanClient[]>>(
    EMPTY_KANBAN_CARDS,
  );
  const shouldLockSellerFilterToCurrentUser = user?.role === "employee";
  const defaultSellerFilter = shouldLockSellerFilterToCurrentUser ? String(user?.id ?? "") : "";
  const [clientesFiltro, setClientesFiltro] = useState(() => {
    try {
      const raw = localStorage.getItem(KANBAN_FILTERS_STORAGE_KEY);
      if (!raw) return { busca: "", status: "", source: "", convenio: "", vendedorId: defaultSellerFilter, monthRef: "" };
      const parsed = JSON.parse(raw) as {
        busca?: string;
        status?: string;
        source?: string;
        convenio?: string;
        vendedorId?: string;
        monthRef?: string;
      };
      const vendedorId = shouldLockSellerFilterToCurrentUser
        ? typeof parsed.vendedorId === "string"
          ? parsed.vendedorId
          : defaultSellerFilter
        : "";
      return {
        busca: typeof parsed.busca === "string" ? parsed.busca : "",
        status: typeof parsed.status === "string" ? parsed.status : "",
        source: typeof parsed.source === "string" ? parsed.source : "",
        convenio: typeof parsed.convenio === "string" ? parsed.convenio : "",
        vendedorId,
        monthRef: typeof parsed.monthRef === "string" ? parsed.monthRef : "",
      };
    } catch {
      return { busca: "", status: "", source: "", convenio: "", vendedorId: defaultSellerFilter, monthRef: "" };
    }
  });
  const [relatoriosFiltro, setRelatoriosFiltro] = useState<{
    monthRef: string;
    busca: string;
    hasMargin: "" | "sim" | "nao";
    status: "" | "ganho" | "perdido";
    vendedorId: string;
    convenio: string;
    source: string;
  }>({
    monthRef: "",
    busca: "",
    hasMargin: "",
    status: "",
    vendedorId: "",
    convenio: "",
    source: "",
  });
  const [comissaoFiltro, setComissaoFiltro] = useState<{
    monthRef: string;
    busca: string;
    vendedorId: string;
    commissionStatus: "" | "pendente" | "pago";
  }>({
    monthRef: "",
    busca: "",
    vendedorId: "",
    commissionStatus: "",
  });
  const [funnelOutcomeReport, setFunnelOutcomeReport] = useState<LoanFunnelOutcomeReport | null>(null);
  const [funnelOutcomeReportLoading, setFunnelOutcomeReportLoading] = useState(false);
  const [updatingLossMarginClientId, setUpdatingLossMarginClientId] = useState<number | null>(null);
  const [updatingCommissionOpportunityId, setUpdatingCommissionOpportunityId] = useState<number | null>(null);
  const [commissionDrafts, setCommissionDrafts] = useState<Record<number, CommissionDraft>>({});
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
  const statusFlowKey = useMemo(() => statusFlow.map((item) => item.key).join("|"), [statusFlow]);
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
        source: clientesFiltro.source.trim() || undefined,
        convenio: clientesFiltro.convenio.trim() || undefined,
        assignedUserId: Number(clientesFiltro.vendedorId) || undefined,
        page: clientesPaginacao.page,
        limit: clientesPaginacao.pageSize,
      };
    },
    [
      statusFlowKey,
      debouncedKanbanSearch,
      clientesFiltro.monthRef,
      clientesFiltro.status,
      clientesFiltro.source,
      clientesFiltro.convenio,
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
  useEffect(() => {
    if (!isQuickAgendaModalOpen) return;
    const term = quickAgendaClientQuery.trim();
    if (term.length < 2) {
      setQuickAgendaClientResults([]);
      setIsLoadingQuickAgendaClients(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoadingQuickAgendaClients(true);
      try {
        const response = await listLoanClients({
          search: term,
          page: 1,
          limit: 50,
        });
        if (cancelled) return;
        setQuickAgendaClientResults(response.items);
      } catch {
        if (cancelled) return;
        setQuickAgendaClientResults([]);
      } finally {
        if (!cancelled) setIsLoadingQuickAgendaClients(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isQuickAgendaModalOpen, quickAgendaClientQuery]);
  const cadastroQuery = useMemo(
    () => {
      const statusNormalizado = statusFlow.some((item) => item.key === cadastroFiltro.status)
        ? (cadastroFiltro.status as LoanClientStatus)
        : undefined;
      return {
        search: debouncedCadastroSearch.trim() || undefined,
        source: cadastroFiltro.source.trim() || undefined,
        assignedUserId: Number(cadastroFiltro.vendedorId) || undefined,
        status: statusNormalizado,
        sortBy: cadastroFiltro.sortBy,
        sortDir: cadastroFiltro.sortDir,
        page: cadastroPaginacao.page,
        limit: cadastroPaginacao.pageSize,
      };
    },
    [
      statusFlowKey,
      debouncedCadastroSearch,
      cadastroFiltro.source,
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
    const sourceTerm = cadastroFiltro.source.trim().toLowerCase();
    return cadastroClientes.filter((client) => {
      const matchesCpf = !cpfTerm || client.cpf.toLowerCase().includes(cpfTerm);
      const matchesCity = !cityTerm || client.city.toLowerCase().includes(cityTerm);
      const matchesProfession = !professionTerm || client.profession.toLowerCase().includes(professionTerm);
      const matchesConvenio = !convenioTerm || client.convenio.toLowerCase().includes(convenioTerm);
      const matchesSource = !sourceTerm || (client.source ?? "").toLowerCase().includes(sourceTerm);
      return matchesCpf && matchesCity && matchesProfession && matchesConvenio && matchesSource;
    });
  }, [
    cadastroClientes,
    cadastroFiltro.cpf,
    cadastroFiltro.city,
    cadastroFiltro.profession,
    cadastroFiltro.convenio,
    cadastroFiltro.source,
  ]);

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
  useEffect(() => {
    if (!selectedClient) return;
    const override = summaryOverrides[selectedClient.id];
    setClientSummaryForm({
      contractValue: formatCurrencyInput(override?.contractValue ?? ""),
      netValue: formatCurrencyInput(override?.netValue ?? ""),
      termMonths: override?.termMonths ?? "",
      interestRate: override?.interestRate ?? "",
      agency: override?.agency ?? "",
      convenio: override?.convenio ?? selectedClient.convenio ?? "",
      contractType: override?.contractType ?? "",
      pdv: override?.pdv ?? "",
      seguro: formatCurrencyInput(override?.seguro ?? ""),
    });
    setIsHeatBadgeMenuOpen(false);
    setIsSummaryEditing(false);
  }, [selectedClient, summaryOverrides]);
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
    for (const convenio of convenioCatalog) pushOption(convenio);
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
  }, [convenioCatalog, savedConvenios, clients, cadastroClientes, clientForm.convenio]);

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

  async function loadConvenioCatalog(): Promise<void> {
    try {
      const data = await listLoanConvenios();
      setConvenioCatalog(data);
    } catch {
      // Mantém os convênios locais já conhecidos se a API falhar.
      setConvenioCatalog([]);
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

  async function loadPipelineStagesData(): Promise<void> {
    try {
      const stages = await listLoanPipelineStages();
      const sorted = [...stages].sort((a, b) => a.position - b.position);
      setPipelineStages(sorted);
    } catch {
      setPipelineStages(
        DEFAULT_STATUS_FLOW.map((item, index) => ({
          key: item.key,
          label: item.label,
          active: true,
          position: (index + 1) * 10,
        })),
      );
      setMessage("Falha ao carregar configuração das colunas do funil.");
    }
  }

  const onOpenStageConfig = () => {
    const source =
      pipelineStages.length > 0
        ? pipelineStages
        : DEFAULT_STATUS_FLOW.map((item, index) => ({
            key: item.key,
            label: item.label,
            active: true,
            position: (index + 1) * 10,
          }));
    setStageConfigItems(
      [...source]
        .sort((a, b) => a.position - b.position)
        .map((item) => ({ key: item.key, label: item.label, active: item.active })),
    );
    setNewStageLabel("");
    setIsStageConfigOpen(true);
  };

  const onMoveStageConfigItem = (index: number, direction: -1 | 1) => {
    setStageConfigItems((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const onDeleteStageConfigItem = async (key: string) => {
    if (!window.confirm("Deseja realmente excluir esta coluna do funil?")) return;
    setIsSavingStageConfig(true);
    try {
      await deleteLoanPipelineStage(key);
      await loadPipelineStagesData();
      setStageConfigItems((current) => current.filter((item) => item.key !== key));
      setMessage("Coluna do funil excluída.");
    } catch (error) {
      setMessage(extractApiMessage(error, "Não foi possível excluir a coluna do funil."));
    } finally {
      setIsSavingStageConfig(false);
    }
  };

  const onCreateStageConfigItem = async () => {
    if (!newStageLabel.trim()) return;
    setIsSavingStageConfig(true);
    try {
      await createLoanPipelineStage(newStageLabel.trim());
      await loadPipelineStagesData();
      setNewStageLabel("");
      setMessage("Nova coluna do funil criada.");
    } catch (error) {
      setMessage(extractApiMessage(error, "Não foi possível criar a nova coluna."));
    } finally {
      setIsSavingStageConfig(false);
    }
  };

  const onSaveStageConfig = async () => {
    if (stageConfigItems.length === 0) {
      setMessage("O funil precisa de ao menos uma coluna.");
      return;
    }
    if (!stageConfigItems.some((item) => item.active)) {
      setMessage("Mantenha ao menos uma coluna ativa.");
      return;
    }
    setIsSavingStageConfig(true);
    try {
      const saved = await updateLoanPipelineStages(stageConfigItems);
      setPipelineStages(saved);
      setIsStageConfigOpen(false);
      setMessage("Configuração do funil atualizada.");
      invalidateLoanViewCaches();
      await refreshVisibleLoanData({ includeCadastro: true, includeAgenda: true });
    } catch (error) {
      setMessage(extractApiMessage(error, "Não foi possível salvar as colunas do funil."));
    } finally {
      setIsSavingStageConfig(false);
    }
  };

  async function loadClientsData(): Promise<void> {
    try {
      if (clientesQuery.status) {
        const response = await listLoanClients({
          search: clientesQuery.search,
          monthRef: clientesQuery.monthRef,
          status: clientesQuery.status,
          source: clientesQuery.source,
          assignedUserId: clientesQuery.assignedUserId,
          page: clientesQuery.page,
          limit: clientesQuery.limit,
        });
        setClients(response.items);
        const byStatus: Record<string, LoanClient[]> = { ...EMPTY_KANBAN_CARDS };
        byStatus[clientesQuery.status] = response.items;
        setKanbanCardsByStatus(byStatus);
        setClientesPaginacao((prev) => ({
          ...prev,
          page: response.page,
          pageSize: response.pageSize,
          total: response.total,
          totalPages: response.totalPages,
        }));
        const totalsByStatus: Record<string, number> = { ...EMPTY_KANBAN_TOTALS };
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
                source: clientesQuery.source,
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
        ) as Record<string, number>;
        const cardsByStatus = Object.fromEntries(
          responsesByStatus.map(([status, result]) => [status, result.items]),
        ) as Record<string, LoanClient[]>;
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
        source: cadastroQuery.source,
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

  async function loadFunnelOutcomeReportData(): Promise<void> {
    setFunnelOutcomeReportLoading(true);
    try {
      const data = await getLoanFunnelOutcomeReport({
        monthRef: /^\d{4}-\d{2}$/.test(relatoriosFiltro.monthRef) ? relatoriosFiltro.monthRef : undefined,
      });
      setFunnelOutcomeReport(data);
    } catch (error) {
      setMessage(extractApiMessage(error, "Falha ao carregar relatórios do funil."));
    } finally {
      setFunnelOutcomeReportLoading(false);
    }
  }

  async function onAdminChangeLossMargin(item: LoanFunnelOutcomeReport["items"][number], nextValue: "sim" | "nao"): Promise<void> {
    if (!isAdmin || item.status !== "perdido") return;
    const nextHasMargin = nextValue === "sim";
    setUpdatingLossMarginClientId(item.id);
    try {
      await updateLoanClientLossMargin(item.id, nextHasMargin);
      setFunnelOutcomeReport((current) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.map((entry) =>
            entry.id === item.id
              ? { ...entry, lostHasMargin: nextHasMargin }
              : entry,
          ),
        };
      });
      setMessage("Margem da perda atualizada.");
    } catch (error) {
      setMessage(extractApiMessage(error, "Não foi possível atualizar a margem da perda."));
    } finally {
      setUpdatingLossMarginClientId(null);
    }
  }

  function buildCommissionDraft(item: LoanFunnelOutcomeReport["items"][number]): CommissionDraft {
    const cardValues = summaryOverrides[item.id];
    return {
      manualMargin: item.commissionManualMargin === null ? "" : String(item.commissionManualMargin),
      contractValue:
        item.commissionContractValue === null ? (cardValues?.contractValue ?? "") : String(item.commissionContractValue),
      netValue: item.commissionNetValue === null ? (cardValues?.netValue ?? "") : String(item.commissionNetValue),
      termMonths: item.commissionTermMonths === null ? (cardValues?.termMonths ?? "") : String(item.commissionTermMonths),
      interestRate:
        item.commissionInterestRate === null ? (cardValues?.interestRate ?? "") : String(item.commissionInterestRate),
      agency: (item.commissionAgency ?? "").trim() || cardValues?.agency || "",
      contractType: (item.commissionContractType ?? "").trim() || cardValues?.contractType || "",
      pdv: (item.commissionPdv ?? "").trim() || cardValues?.pdv || "",
      assignedUserId: item.assignedUserId ? String(item.assignedUserId) : "",
      commissionStatus: item.commissionStatus ?? "pendente",
      notes: item.commissionNotes ?? "",
    };
  }

  async function onSaveCommissionData(item: LoanFunnelOutcomeReport["items"][number]): Promise<void> {
    const draft = commissionDrafts[item.opportunityId] ?? buildCommissionDraft(item);
    const parseOptionalNumber = (value: string): number | null => {
      return parseLocaleNumber(value);
    };
    const parseOptionalInt = (value: string): number | null => {
      const normalized = value.trim();
      if (!normalized) return null;
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(1, Math.round(parsed));
    };

    setUpdatingCommissionOpportunityId(item.opportunityId);
    try {
      await updateLoanOpportunityCommissionData(item.opportunityId, {
        manualMargin: parseOptionalNumber(draft.manualMargin),
        contractValue: parseOptionalNumber(draft.contractValue),
        netValue: parseOptionalNumber(draft.netValue),
        termMonths: parseOptionalInt(draft.termMonths),
        interestRate: parseOptionalNumber(draft.interestRate),
        agency: draft.agency.trim(),
        contractType: draft.contractType.trim(),
        pdv: draft.pdv.trim(),
        assignedUserId: isAdmin ? (Number(draft.assignedUserId) || null) : undefined,
        commissionStatus: draft.commissionStatus,
        notes: draft.notes.trim(),
      });
      const nextAssignedUserId = Number(draft.assignedUserId) || null;
      const nextAssignedUserName =
        sellerOptions.find((seller) => seller.id === nextAssignedUserId)?.name ?? item.assignedUserName ?? null;
      setFunnelOutcomeReport((current) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.map((entry) =>
            entry.opportunityId === item.opportunityId
              ? {
                  ...entry,
                  commissionManualMargin: parseOptionalNumber(draft.manualMargin),
                  commissionContractValue: parseOptionalNumber(draft.contractValue),
                  commissionNetValue: parseOptionalNumber(draft.netValue),
                  commissionTermMonths: parseOptionalInt(draft.termMonths),
                  commissionInterestRate: parseOptionalNumber(draft.interestRate),
                  commissionAgency: draft.agency.trim(),
                  commissionContractType: draft.contractType.trim(),
                  commissionPdv: draft.pdv.trim(),
                  assignedUserId: isAdmin ? nextAssignedUserId : entry.assignedUserId,
                  assignedUserName: isAdmin ? nextAssignedUserName : entry.assignedUserName,
                  commissionStatus: draft.commissionStatus,
                  commissionNotes: draft.notes.trim(),
                  commissionUpdatedAt: new Date().toISOString(),
                }
              : entry,
          ),
        };
      });
      setMessage("Dados de comissão atualizados.");
    } catch (error) {
      setMessage(extractApiMessage(error, "Falha ao salvar dados de comissão."));
    } finally {
      setUpdatingCommissionOpportunityId(null);
    }
  }

  async function onAdminExcluirGanho(item: LoanFunnelOutcomeReport["items"][number]): Promise<void> {
    if (!isAdmin) return;
    const ganhoIndex = statusFlow.findIndex((status) => status.key === "ganho");
    const previousActiveStatus =
      ganhoIndex > 0
        ? statusFlow
            .slice(0, ganhoIndex)
            .reverse()
            .find((status) => !isTerminalFlowStatus(status.key))?.key ?? null
        : null;
    const fallbackStatus = getFirstCycleStatus();
    const targetStatus = previousActiveStatus ?? fallbackStatus;
    if (!targetStatus) {
      setMessage("Não foi possível identificar a etapa de retorno no funil.");
      return;
    }
    if (
      !window.confirm(
        `Deseja excluir este card de ganho e retornar o cliente para "${getStatusLabel(targetStatus)}"?`,
      )
    ) {
      return;
    }
    setUpdatingCommissionOpportunityId(item.opportunityId);
    try {
      await updateLoanClientStatus(item.id, targetStatus);
      invalidateLoanViewCaches();
      await Promise.all([
        loadFunnelOutcomeReportData(),
        refreshVisibleLoanData({ includeCadastro: true, includeAgenda: true }),
      ]);
      setCommissionDrafts((current) => {
        const next = { ...current };
        delete next[item.opportunityId];
        return next;
      });
      setMessage(`Card removido de ganho e retornado para ${getStatusLabel(targetStatus)}.`);
    } catch (error) {
      setMessage(extractApiMessage(error, "Não foi possível excluir o ganho."));
    } finally {
      setUpdatingCommissionOpportunityId(null);
    }
  }

  async function loadClientDetails(clientId: number): Promise<void> {
    try {
      const [simulationsData, opportunitiesData, timelineData] = await Promise.all([
        listLoanSimulations(clientId),
        listLoanOpportunities(clientId),
        listLoanTimeline(clientId),
      ]);
      setSimulations(simulationsData);
      setOpportunities(opportunitiesData);
      setTimelineItems(timelineData);
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
    void loadConvenioCatalog();
    void loadPipelineStagesData();
    if (isAdmin) {
      void loadLoanSettings();
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    void loadClientsData();
  }, [clientesQuery, loading]);

  useEffect(() => {
    const validStatusKeys = new Set(statusFlow.map((item) => item.key));
    if (clientesFiltro.status && !validStatusKeys.has(clientesFiltro.status as LoanClientStatus)) {
      setClientesFiltro((prev) => ({ ...prev, status: "" }));
    }
    if (cadastroFiltro.status && !validStatusKeys.has(cadastroFiltro.status as LoanClientStatus)) {
      setCadastroFiltro((prev) => ({ ...prev, status: "" }));
    }
  }, [statusFlow, clientesFiltro.status, cadastroFiltro.status]);

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
    if (loading || loanSection !== "relatorios") return;
    void loadFunnelOutcomeReportData();
  }, [loanSection, relatoriosFiltro.monthRef, loading]);

  useEffect(() => {
    if (loading || loanSection !== "comissao") return;
    if (comissaoFiltro.monthRef !== relatoriosFiltro.monthRef) {
      setRelatoriosFiltro((prev) => ({ ...prev, monthRef: comissaoFiltro.monthRef }));
      return;
    }
    void loadFunnelOutcomeReportData();
  }, [loanSection, comissaoFiltro.monthRef, relatoriosFiltro.monthRef, loading]);

  useEffect(() => {
    if (!funnelOutcomeReport || loanSection !== "comissao") return;
    setCommissionDrafts((current) => {
      const next = { ...current };
      for (const item of funnelOutcomeReport.items) {
        const draft = next[item.opportunityId];
        const hasCardValues = Boolean(summaryOverrides[item.id]);
        const shouldHydrateFromCard =
          hasCardValues &&
          draft &&
          !draft.contractValue &&
          !draft.netValue &&
          !draft.termMonths &&
          !draft.interestRate &&
          !draft.agency &&
          !draft.contractType &&
          !draft.pdv;
        if (!draft || shouldHydrateFromCard) {
          next[item.opportunityId] = buildCommissionDraft(item);
        }
      }
      return next;
    });
  }, [funnelOutcomeReport, loanSection, summaryOverrides]);

  useEffect(() => {
    try {
      localStorage.setItem(
        KANBAN_FILTERS_STORAGE_KEY,
        JSON.stringify({
          busca: clientesFiltro.busca,
          monthRef: clientesFiltro.monthRef,
          status: clientesFiltro.status,
          source: clientesFiltro.source,
          convenio: clientesFiltro.convenio,
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
    clientesFiltro.source,
    clientesFiltro.convenio,
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
          source: cadastroFiltro.source,
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
    cadastroFiltro.source,
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
      setTimelineItems([]);
      setTimelineFilter("all");
      setSimulations([]);
      setOpportunities([]);
      setIsCycleHistoryModalOpen(false);
      setInteractionScheduledFor("");
      return;
    }
    setTimelineItems([]);
    setTimelineFilter("all");
    setSimulations([]);
    setOpportunities([]);
    setInteractionScheduledFor("");
    void loadClientDetails(selectedClientId);
  }, [selectedClientId]);

  useEffect(() => {
    const cepDigits = onlyDigits(clientForm.cep);
    if (cepDigits.length !== 8) {
      setCepLookupMessage("");
      setIsLoadingCep(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setIsLoadingCep(true);
          const response = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`, {
            signal: controller.signal,
          });
          if (!response.ok) {
            setCepLookupMessage("Não foi possível consultar o CEP agora.");
            return;
          }
          const data = (await response.json()) as {
            erro?: boolean;
            logradouro?: string;
            bairro?: string;
            localidade?: string;
            uf?: string;
          };
          if (data.erro) {
            setCepLookupMessage("CEP não encontrado.");
            return;
          }
          setClientForm((prev) => {
            if (onlyDigits(prev.cep) !== cepDigits) return prev;
            return {
              ...prev,
              addressStreet: prev.addressStreet || data.logradouro || "",
              addressNeighborhood: prev.addressNeighborhood || data.bairro || "",
              city: prev.city || data.localidade || "",
              addressState: prev.addressState || data.uf || "",
            };
          });
          setCepLookupMessage("Endereço preenchido automaticamente. Você pode editar se precisar.");
        } catch {
          if (!controller.signal.aborted) {
            setCepLookupMessage("Não foi possível consultar o CEP agora.");
          }
        } finally {
          if (!controller.signal.aborted) {
            setIsLoadingCep(false);
          }
        }
      })();
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      setIsLoadingCep(false);
    };
  }, [clientForm.cep]);

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
      cep: clientForm.cep,
      addressStreet: clientForm.addressStreet,
      addressNumber: clientForm.addressNumber,
      addressComplement: clientForm.addressComplement,
      addressNeighborhood: clientForm.addressNeighborhood,
      city: clientForm.city,
      addressState: clientForm.addressState,
      profession: clientForm.profession,
      convenio: "",
      income: 0,
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
        cep: "",
        addressStreet: "",
        addressNumber: "",
        addressComplement: "",
        addressNeighborhood: "",
        city: "",
        addressState: "",
        profession: "",
        convenio: "",
        income: "0",
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
      cep: formatCep(client.cep || ""),
      addressStreet: client.addressStreet || "",
      addressNumber: client.addressNumber || "",
      addressComplement: client.addressComplement || "",
      addressNeighborhood: client.addressNeighborhood || "",
      city: client.city || "",
      addressState: client.addressState || "",
      profession: client.profession || "",
      convenio: client.convenio || "",
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
      ) as Record<string, LoanClient[]>;
      next[status] = [...next[status], { ...moving, status }];
      return next;
    });
    try {
      await updateLoanClientStatus(clientId, status);
      setRecentlyMovedClientId(clientId);
      window.setTimeout(() => {
        setRecentlyMovedClientId((current) => (current === clientId ? null : current));
      }, 1200);
      invalidateLoanViewCaches();
      try {
        await refreshVisibleLoanData();
      } catch (error) {
        setMessage(extractApiMessage(error, "Status atualizado, mas falhou ao recarregar os dados."));
      }
    } catch (error) {
      setClients(previous);
      setKanbanCardsByStatus(previousByStatus);
      setMessage(extractApiMessage(error, "Não foi possível atualizar status."));
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
      clientId: "",
      scheduledFor: toDateTimeLocalValue(startDate),
    }));
    setQuickAgendaClientQuery("");
    setQuickAgendaClientResults([]);
    setIsQuickAgendaClientDropdownOpen(false);
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
      setQuickAgendaClientQuery("");
      setQuickAgendaClientResults([]);
      setIsQuickAgendaClientDropdownOpen(false);
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

  const onOpenAgendaDetailsModal = (item: LoanAgendaItem) => {
    setSelectedAgendaItem(item);
  };

  const onCloseAgendaDetailsModal = () => {
    setSelectedAgendaItem(null);
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
      setIsLoanSettingsModalOpen(false);
    } catch {
      setMessage("Falha ao salvar configuração de margem.");
    } finally {
      setIsSavingLoanSettings(false);
    }
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
    if (isTerminalFlowStatus(status)) return null;
    const currentIndex = statusFlow.findIndex((item) => item.key === status);
    if (currentIndex < 0 || currentIndex >= statusFlow.length - 1) return null;
    return statusFlow[currentIndex + 1]?.key ?? null;
  };
  const getStatusLabel = (status: LoanClientStatus): string => {
    return statusFlow.find((item) => item.key === status)?.label ?? status;
  };
  const isTerminalFlowStatus = (status: LoanClientStatus): boolean => {
    if (TERMINAL_FUNNEL_STATUS.has(status)) return true;
    const stage = statusFlow.find((item) => item.key === status);
    if (!stage) return false;
    const normalized = stage.label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return normalized.includes("ganho") || normalized.includes("perdido") || normalized.includes("perda");
  };
  const getTimelineCategory = (
    item: LoanTimelineItem,
  ): "activity" | "status" | "agenda" | "simulation" | "loss" | "client" | "event" => {
    if (item.kind === "interaction") {
      return "activity";
    }
    if (item.action === "loan.client.status") {
      return "status";
    }
    if (item.action?.startsWith("loan.agenda.")) {
      return "agenda";
    }
    if (item.action === "loan.simulation.create") {
      return "simulation";
    }
    if (item.action === "loan.client.loss_margin.update") {
      return "loss";
    }
    if (item.action?.startsWith("loan.client.")) {
      return "client";
    }
    return "event";
  };
  const getTimelineMeta = (item: LoanTimelineItem): { label: string; className: string } => {
    const category = getTimelineCategory(item);
    if (category === "activity") return { label: "Atividade", className: "timeline-activity" };
    if (category === "status") return { label: "Status", className: "timeline-status" };
    if (category === "agenda") return { label: "Agenda", className: "timeline-agenda" };
    if (category === "simulation") return { label: "Simulação", className: "timeline-simulation" };
    if (category === "loss") return { label: "Perda", className: "timeline-loss" };
    if (category === "client") return { label: "Cliente", className: "timeline-client" };
    return { label: "Evento", className: "timeline-event" };
  };
  const filteredTimelineItems = useMemo(() => {
    if (timelineFilter === "all") return timelineItems;
    return timelineItems.filter((item) => getTimelineCategory(item) === timelineFilter);
  }, [timelineItems, timelineFilter]);
  const timelineCounts = useMemo(() => {
    const counts = {
      all: timelineItems.length,
      activity: 0,
      status: 0,
      agenda: 0,
      simulation: 0,
      loss: 0,
      client: 0,
      event: 0,
    };
    for (const item of timelineItems) {
      const category = getTimelineCategory(item);
      counts[category] += 1;
    }
    return counts;
  }, [timelineItems]);
  const getFirstCycleStatus = (): LoanClientStatus | null => {
    const firstNonTerminal = statusFlow.find((item) => !isTerminalFlowStatus(item.key));
    return firstNonTerminal?.key ?? statusFlow[0]?.key ?? null;
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
  const onRestartClientCycle = async (client: LoanClient) => {
    const firstStatus = getFirstCycleStatus();
    if (!firstStatus) {
      setMessage("Nenhuma etapa disponível para iniciar novo ciclo.");
      return;
    }
    if (client.status === firstStatus) return;
    await onMoveClientToStatus(client, firstStatus);
    setMessage("Novo ciclo iniciado para o cliente.");
  };
  const onOpenLostReasonModal = () => {
    setLostReasonText("");
    setLostHasMargin("");
    setIsLostReasonModalOpen(true);
  };

  const onConfirmLostReason = async () => {
    if (!selectedClient) return;
    if (!lostReasonText.trim()) {
      setMessage("Informe o motivo da perda.");
      return;
    }
    if (!lostHasMargin) {
      setMessage("Informe se o cliente possui margem.");
      return;
    }
    try {
      setIsLostReasonModalOpen(false);
      const marginLabel = lostHasMargin === "sim" ? "Sim" : "Não";
      await onMoveClientToStatus(
        selectedClient,
        "perdido",
        `${lostReasonText.trim()} | Possui margem: ${marginLabel}`,
      );
      setLostReasonText("");
      setLostHasMargin("");
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
          {} as Record<string, LoanClient[]>,
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
      const normalizedContractValue = normalizeCurrencyInput(clientSummaryForm.contractValue);
      const normalizedNetValue = normalizeCurrencyInput(clientSummaryForm.netValue);
      const normalizedSeguro = normalizeCurrencyInput(clientSummaryForm.seguro);
      const normalizedTermMonths = clientSummaryForm.termMonths.trim();
      const normalizedInterestRateNumber = parseLocaleNumber(clientSummaryForm.interestRate);
      const normalizedInterestRate = normalizedInterestRateNumber === null ? "" : String(normalizedInterestRateNumber);
      const normalizedAgency = clientSummaryForm.agency.trim();
      const normalizedConvenio = clientSummaryForm.convenio.trim();
      const normalizedContractType = clientSummaryForm.contractType.trim();
      const normalizedPdv = clientSummaryForm.pdv.trim();
      setSummaryOverrides((current) => ({
        ...current,
        [selectedClient.id]: {
          contractValue: normalizedContractValue,
          netValue: normalizedNetValue,
          termMonths: normalizedTermMonths,
          interestRate: normalizedInterestRate,
          agency: normalizedAgency,
          convenio: normalizedConvenio,
          contractType: normalizedContractType,
          pdv: normalizedPdv,
          seguro: normalizedSeguro,
        },
      }));

      const parseOptionalNumber = (value: string): number | null => {
        return parseLocaleNumber(value);
      };
      const parseOptionalInt = (value: string): number | null => {
        const normalized = value.trim();
        if (!normalized) return null;
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed)) return null;
        return Math.max(1, Math.round(parsed));
      };
      const gainOpportunityFromReport = (funnelOutcomeReport?.items ?? [])
        .filter((item) => item.id === selectedClient.id && item.status === "ganho")
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
      let gainOpportunityId = gainOpportunityFromReport?.opportunityId ?? null;

      if (!gainOpportunityId) {
        try {
          const opportunities = await listLoanOpportunities(selectedClient.id);
          const gainOpportunityFromClient = opportunities
            .filter((item) => item.outcome === "ganho" || item.status === "ganho")
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
          gainOpportunityId = gainOpportunityFromClient?.id ?? null;
        } catch {
          // Se não conseguir carregar oportunidades, mantém o salvamento local do card.
        }
      }

      if (gainOpportunityId) {
        try {
          await updateLoanOpportunityCommissionData(gainOpportunityId, {
            contractValue: parseOptionalNumber(normalizedContractValue),
            netValue: parseOptionalNumber(normalizedNetValue),
            termMonths: parseOptionalInt(normalizedTermMonths),
            interestRate: parseOptionalNumber(normalizedInterestRate),
            agency: normalizedAgency,
            contractType: normalizedContractType,
            pdv: normalizedPdv,
          });
          setFunnelOutcomeReport((current) => {
            if (!current) return current;
            return {
              ...current,
              items: current.items.map((entry) =>
                entry.opportunityId === gainOpportunityId
                  ? {
                      ...entry,
                      commissionContractValue: parseOptionalNumber(normalizedContractValue),
                      commissionNetValue: parseOptionalNumber(normalizedNetValue),
                      commissionTermMonths: parseOptionalInt(normalizedTermMonths),
                      commissionInterestRate: parseOptionalNumber(normalizedInterestRate),
                      commissionAgency: normalizedAgency,
                      commissionContractType: normalizedContractType,
                      commissionPdv: normalizedPdv,
                    }
                  : entry,
              ),
            };
          });
          setCommissionDrafts((current) => ({
            ...current,
            [gainOpportunityId]: {
              ...(current[gainOpportunityId] ?? {
                manualMargin: "",
                contractValue: "",
                netValue: "",
                termMonths: "",
                interestRate: "",
                agency: "",
                contractType: "",
                pdv: "",
                assignedUserId: "",
                commissionStatus: "pendente" as const,
                notes: "",
              }),
              contractValue: normalizedContractValue,
              netValue: normalizedNetValue,
              termMonths: normalizedTermMonths,
              interestRate: normalizedInterestRate,
              agency: normalizedAgency,
              contractType: normalizedContractType,
              pdv: normalizedPdv,
            },
          }));
        } catch (error) {
          setMessage(extractApiMessage(error, "Card atualizado, mas não foi possível sincronizar em Comissões."));
          setIsSummaryEditing(false);
          return;
        }
      }
      setIsSummaryEditing(false);
      setMessage(gainOpportunityId ? "Dados manuais do card atualizados." : "Card atualizado. Sem card ganho para sincronizar em Comissões.");
    } catch {
      setMessage("Não foi possível atualizar os dados manuais do card.");
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
    const colorsByStatus: Record<string, { bg: string; border: string; text: string }> = {
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

  const onCadastrarServidor = (servant: ImportedServant) => {
    const cpfRelacionadoFormatado = formatCpf(servant.seconsigCpf ?? servant.cpfRelacionado ?? "");
    setEditingClientId(null);
    setClientForm({
      name: servant.name,
      cpf: cpfRelacionadoFormatado,
      phones: [""],
      cep: "",
      addressStreet: "",
      addressNumber: "",
      addressComplement: "",
      addressNeighborhood: "",
      city: servant.lotacao || "",
      addressState: "",
      profession: "",
      convenio: "",
      income: "0",
      heatBadge: null,
      source: `portal_transparencia:${servant.unidadeGestora || "sergipe"}`,
      status: "novo",
      assignedUserId: user?.id ?? sellerOptions[0]?.id ?? 0,
      assignedUserName: user?.name ?? sellerOptions[0]?.name ?? "",
    });
    setIsClientModalOpen(true);
    setMessage(
      cpfRelacionadoFormatado
        ? "CPF preenchido automaticamente. Confira os dados e complete os telefones."
        : "Complete CPF e telefones para concluir o cadastro do cliente.",
    );
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

  const onExportFunnelOutcomeReport = () => {
    if (!funnelOutcomeReport || filteredFunnelOutcomeReportItems.length === 0) {
      setMessage("Não há dados no relatório para exportar.");
      return;
    }

    const resumoRows: Array<Array<string | number>> = [
      ["Relatório do Funil - Ganho e Perda"],
      ["Gerado em", new Date(funnelOutcomeReport.generatedAt).toLocaleString("pt-BR")],
      ["Competência", funnelOutcomeReport.monthRef ? monthRefLabel(funnelOutcomeReport.monthRef) : "Todas"],
      ["Total", filteredFunnelOutcomeTotals.total],
      ["Ganhos", filteredFunnelOutcomeTotals.ganho],
      ["Perdas", filteredFunnelOutcomeTotals.perdido],
    ];

    const detailsRows = filteredFunnelOutcomeReportItems.map((item) => ({
      Status: item.status === "ganho" ? "Ganho" : "Perdido",
      Nome: item.name,
      CPF: item.cpf,
      Telefones: item.phones.length > 0 ? item.phones.join(", ") : "",
      Cidade: item.city ?? "",
      Profissao: item.profession ?? "",
      Convenio: item.convenio ?? "",
      Renda: Number(item.income ?? 0),
      Origem: item.source ?? "",
      Vendedor: item.assignedUserName ?? "",
      AtualizadoEm: item.updatedAt ? new Date(item.updatedAt).toLocaleString("pt-BR") : "",
      PossuiMargem: item.lostHasMargin === null ? "" : item.lostHasMargin ? "Sim" : "Não",
      MotivoPerda: item.lostReason ?? "",
    }));

    const workbook = XLSX.utils.book_new();
    const resumoSheet = XLSX.utils.aoa_to_sheet(resumoRows);
    const detailsSheet = XLSX.utils.json_to_sheet(detailsRows);
    XLSX.utils.book_append_sheet(workbook, resumoSheet, "Resumo");
    XLSX.utils.book_append_sheet(workbook, detailsSheet, "Detalhes");

    const today = new Date();
    const dateToken = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const monthToken = funnelOutcomeReport.monthRef ?? "geral";
    XLSX.writeFile(workbook, `relatorio-funil-${monthToken}-${dateToken}.xlsx`);
    setMessage("Relatório exportado em Excel.");
  };

  const filteredFunnelOutcomeReportItems = useMemo(() => {
    const items = funnelOutcomeReport?.items ?? [];
    const busca = relatoriosFiltro.busca.trim().toLowerCase();
    const buscaCpfDigits = relatoriosFiltro.busca.replace(/\D/g, "");
    const statusFilter = relatoriosFiltro.status;
    const hasMarginFilter = relatoriosFiltro.hasMargin;
    const convenioFilter = relatoriosFiltro.convenio.trim().toLowerCase();
    const sourceFilter = relatoriosFiltro.source.trim().toLowerCase();
    const selectedSellerName =
      relatoriosFiltro.vendedorId && sellerOptions.some((seller) => String(seller.id) === relatoriosFiltro.vendedorId)
        ? (sellerOptions.find((seller) => String(seller.id) === relatoriosFiltro.vendedorId)?.name ?? "").toLowerCase()
        : "";

    return items.filter((item) => {
      const itemName = (item.name ?? "").toLowerCase();
      const itemCpf = (item.cpf ?? "").toLowerCase();
      const itemCpfDigits = item.cpf.replace(/\D/g, "");
      const itemSeller = (item.assignedUserName ?? "").toLowerCase();
      const itemConvenio = (item.convenio ?? "").toLowerCase();
      const itemSource = (item.source ?? "").toLowerCase();

      const matchesBusca =
        !busca ||
        itemName.includes(busca) ||
        itemCpf.includes(busca) ||
        (buscaCpfDigits.length > 0 && itemCpfDigits.includes(buscaCpfDigits));
      const matchesStatus = !statusFilter || item.status === statusFilter;
      const matchesSeller = !selectedSellerName || itemSeller === selectedSellerName;
      const matchesConvenio = !convenioFilter || itemConvenio.includes(convenioFilter);
      const matchesSource = !sourceFilter || itemSource.includes(sourceFilter);
      const matchesMargin =
        !hasMarginFilter ||
        (hasMarginFilter === "sim" && item.lostHasMargin === true) ||
        (hasMarginFilter === "nao" && item.lostHasMargin === false);

      return (
        matchesBusca &&
        matchesStatus &&
        matchesSeller &&
        matchesConvenio &&
        matchesSource &&
        matchesMargin
      );
    });
  }, [funnelOutcomeReport, relatoriosFiltro, sellerOptions]);

  const filteredFunnelOutcomeTotals = useMemo(() => {
    const ganho = filteredFunnelOutcomeReportItems.filter((item) => item.status === "ganho").length;
    const perdido = filteredFunnelOutcomeReportItems.filter((item) => item.status === "perdido").length;
    return {
      ganho,
      perdido,
      total: filteredFunnelOutcomeReportItems.length,
    };
  }, [filteredFunnelOutcomeReportItems]);

  const filteredCommissionItems = useMemo(() => {
    const ganhoItems = (funnelOutcomeReport?.items ?? []).filter(
      (item) => item.status === "ganho" && item.currentClientStatus === "ganho",
    );
    const latestByClient = new Map<number, (typeof ganhoItems)[number]>();
    for (const item of ganhoItems) {
      const current = latestByClient.get(item.id);
      if (!current) {
        latestByClient.set(item.id, item);
        continue;
      }
      const currentTime = new Date(current.updatedAt).getTime();
      const nextTime = new Date(item.updatedAt).getTime();
      if (nextTime >= currentTime) {
        latestByClient.set(item.id, item);
      }
    }
    const items = Array.from(latestByClient.values());
    const busca = comissaoFiltro.busca.trim().toLowerCase();
    const buscaCpfDigits = comissaoFiltro.busca.replace(/\D/g, "");
    const statusFilter = comissaoFiltro.commissionStatus;
    return items.filter((item) => {
      if (!isAdmin && Number(item.assignedUserId ?? 0) !== Number(user?.id ?? 0)) return false;
      if (comissaoFiltro.vendedorId && String(item.assignedUserId ?? "") !== comissaoFiltro.vendedorId) return false;
      if (statusFilter && item.commissionStatus !== statusFilter) return false;
      const itemName = (item.name ?? "").toLowerCase();
      const itemCpf = (item.cpf ?? "").toLowerCase();
      const itemCpfDigits = item.cpf.replace(/\D/g, "");
      return (
        !busca ||
        itemName.includes(busca) ||
        itemCpf.includes(busca) ||
        (buscaCpfDigits.length > 0 && itemCpfDigits.includes(buscaCpfDigits))
      );
    });
  }, [funnelOutcomeReport, comissaoFiltro, isAdmin, user?.id]);

  const commissionTotals = useMemo(() => {
    const parseDraftNumber = (value: string): number => {
      return parseLocaleNumber(value) ?? 0;
    };
    let pago = 0;
    let pendente = 0;
    let valorContratoTotal = 0;
    let valorLiquidoTotal = 0;
    for (const item of filteredCommissionItems) {
      const draft = commissionDrafts[item.opportunityId] ?? buildCommissionDraft(item);
      if (draft.commissionStatus === "pago") pago += 1;
      else pendente += 1;
      valorContratoTotal += parseDraftNumber(draft.contractValue);
      valorLiquidoTotal += parseDraftNumber(draft.netValue);
    }
    return {
      total: filteredCommissionItems.length,
      pago,
      pendente,
      valorContratoTotal,
      valorLiquidoTotal,
    };
  }, [filteredCommissionItems, commissionDrafts, summaryOverrides]);

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
        {resolvedSectionVisibility.cadastro ? (
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
        ) : null}
        {resolvedSectionVisibility.funil ? (
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
        ) : null}
        {resolvedSectionVisibility.agenda ? (
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
        ) : null}
        {resolvedSectionVisibility.importacoes ? (
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
        ) : null}
        {resolvedSectionVisibility.comissao ? (
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
        ) : null}
        {resolvedSectionVisibility.relatorios ? (
          <button
            type="button"
            className={loanSection === "relatorios" ? "active" : ""}
            onClick={() => setLoanSection("relatorios")}
          >
            <span className="loan-menu-icon-label">
              <MenuRelatoriosIcon />
              <span>Relatórios</span>
            </span>
          </button>
        ) : null}
      </section>

      {availableSections.length === 0 ? (
        <section className="card">
          <p className="muted-text">Seu usuário não possui submenus liberados no Negocial.</p>
        </section>
      ) : null}

      {loanSection === "funil" ? (
        <section className="card loan-dashboard">
          <div className="section-header-row loan-dashboard-header">
            <h3 className="loan-title-icon-label">
              <MenuFunilIcon />
              <span>Funil de Vendas</span>
            </h3>
            {isAdmin ? (
              <div className="row">
                <button type="button" className="loan-filter-clear-button" onClick={onOpenStageConfig}>
                  Configurar colunas
                </button>
                <button
                  type="button"
                  className="loan-filter-clear-button"
                  onClick={() => setIsLoanSettingsModalOpen(true)}
                >
                  Configurar taxas
                </button>
              </div>
            ) : null}
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
                  cep: "",
                  addressStreet: "",
                  addressNumber: "",
                  addressComplement: "",
                  addressNeighborhood: "",
                  city: "",
                  addressState: "",
                  profession: "",
                  convenio: "",
                  income: "0",
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
            <select
              value={cadastroFiltro.source}
              onChange={(event) => {
                setCadastroFiltro((prev) => ({ ...prev, source: event.target.value }));
                setCadastroPaginacao((prev) => ({ ...prev, page: 1 }));
              }}
            >
              <option value="">Todas as origens</option>
              {sourceOptions.map((source) => (
                <option key={`cadastro-source-${source}`} value={source}>
                  {source}
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
            className="loan-funil-search-input"
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
            value={clientesFiltro.source}
            onChange={(event) => {
              setClientesFiltro((prev) => ({ ...prev, source: event.target.value }));
              setClientesPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="">Todas as origens</option>
            {sourceOptions.map((source) => (
              <option key={`funil-source-${source}`} value={source}>
                {source}
              </option>
            ))}
          </select>
          <select
            value={clientesFiltro.convenio}
            onChange={(event) => {
              setClientesFiltro((prev) => ({ ...prev, convenio: event.target.value }));
              setClientesPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            <option value="">Todos os convênios</option>
            {convenioOptions.map((convenio) => (
              <option key={`funil-convenio-${convenio}`} value={convenio}>
                {convenio}
              </option>
            ))}
          </select>
          <select
            className="loan-funil-month-select"
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
            className="loan-filter-clear-button loan-funil-clear-button"
            type="button"
            onClick={() => {
              setClientesFiltro({ busca: "", status: "", source: "", convenio: "", vendedorId: "", monthRef: "" });
              setClientesPaginacao((prev) => ({ ...prev, page: 1 }));
            }}
          >
            Limpar
          </button>
        </div>
        <div className="loan-heat-legend loan-heat-legend-funil" aria-label="Legenda de temperatura dos clientes">
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
                    setIsCycleHistoryModalOpen(false);
                  }}
                >
                  X
                </button>
                <div className="loan-client-modal-stage-actions">
                  {isTerminalFlowStatus(selectedClient.status) ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void onRestartClientCycle(selectedClient)}
                      disabled={movingNextStageClientId === selectedClient.id || !getFirstCycleStatus()}
                    >
                      Iniciar novo ciclo
                    </button>
                  ) : (
                    <>
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
                    </>
                  )}
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
                data-tooltip="Histórico de ciclos"
                aria-label="Histórico de ciclos"
                onClick={() => setIsCycleHistoryModalOpen(true)}
              >
                <CycleHistoryIcon />
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
                <h4>Dados do Cadastro</h4>
              </div>
              <div className="loan-client-summary-compact">
                <p>
                  <strong>Nome:</strong> {selectedClient.name || "-"} | <strong>CPF:</strong> {selectedClient.cpf || "-"} |{" "}
                  <strong>Telefone:</strong> {formatPhonesDisplay(selectedClient.phones, "-")}
                </p>
                <p>
                  <strong>Profissão:</strong> {selectedClient.profession || "-"} | <strong>Origem:</strong>{" "}
                  {selectedClient.source || "-"}
                </p>
                <p>
                  <strong>Endereço:</strong>{" "}
                  {[
                    selectedClient.addressStreet || "",
                    selectedClient.addressNumber ? `, ${selectedClient.addressNumber}` : "",
                    selectedClient.addressComplement ? ` - ${selectedClient.addressComplement}` : "",
                    selectedClient.addressNeighborhood ? ` - ${selectedClient.addressNeighborhood}` : "",
                    selectedClient.city ? ` - ${selectedClient.city}` : "",
                    selectedClient.addressState ? `/${selectedClient.addressState}` : "",
                    selectedClient.cep ? ` - CEP ${selectedClient.cep}` : "",
                  ]
                    .join("")
                    .trim() || "-"}
                </p>
              </div>
            </section>
            <section className="loan-client-summary">
              <div className="section-header-row">
                <div className="section-title-with-action">
                  <h4>Dados do Contrato</h4>
                  <button
                    type="button"
                    className="transaction-icon-button"
                    onClick={() => setIsSummaryEditing((current) => !current)}
                    title={isSummaryEditing ? "Fechar edição" : "Editar dados"}
                    aria-label={isSummaryEditing ? "Fechar edição" : "Editar dados"}
                  >
                    <PencilIcon />
                  </button>
                </div>
              </div>
              <div className="loan-client-summary-form">
                <label>
                  VALOR CONTRATO
                  <input
                    type="text"
                    inputMode="numeric"
                    value={clientSummaryForm.contractValue}
                    disabled={!isSummaryEditing}
                    onChange={(event) =>
                      setClientSummaryForm((prev) => ({
                        ...prev,
                        contractValue: formatCurrencyInput(event.target.value),
                      }))
                    }
                    placeholder="R$ 0,00"
                  />
                </label>
                <label>
                  VALOR LIQUIDO
                  <input
                    type="text"
                    inputMode="numeric"
                    value={clientSummaryForm.netValue}
                    disabled={!isSummaryEditing}
                    onChange={(event) =>
                      setClientSummaryForm((prev) => ({
                        ...prev,
                        netValue: formatCurrencyInput(event.target.value),
                      }))
                    }
                    placeholder="R$ 0,00"
                  />
                </label>
                <label>
                  PRAZO
                  <input
                    type="number"
                    min={1}
                    step="1"
                    value={clientSummaryForm.termMonths}
                    disabled={!isSummaryEditing}
                    onChange={(event) =>
                      setClientSummaryForm((prev) => ({ ...prev, termMonths: event.target.value }))
                    }
                  />
                </label>
                <label>
                  TAXA DE JUROS
                  <input
                    type="number"
                    min={0}
                    step="0.0001"
                    value={clientSummaryForm.interestRate}
                    disabled={!isSummaryEditing}
                    onChange={(event) =>
                      setClientSummaryForm((prev) => ({ ...prev, interestRate: event.target.value }))
                    }
                  />
                </label>
                <label>
                  AGÊNCIA
                  <input
                    value={clientSummaryForm.agency}
                    disabled={!isSummaryEditing}
                    onChange={(event) =>
                      setClientSummaryForm((prev) => ({ ...prev, agency: event.target.value }))
                    }
                  />
                </label>
                <label>
                  CONVÊNIO
                  <input
                    value={clientSummaryForm.convenio}
                    disabled={!isSummaryEditing}
                    onChange={(event) =>
                      setClientSummaryForm((prev) => ({ ...prev, convenio: event.target.value }))
                    }
                  />
                </label>
                <label>
                  TIPO DE CONTRATO
                  <input
                    value={clientSummaryForm.contractType}
                    disabled={!isSummaryEditing}
                    onChange={(event) =>
                      setClientSummaryForm((prev) => ({ ...prev, contractType: event.target.value }))
                    }
                  />
                </label>
                <label>
                  PDV
                  <input
                    value={clientSummaryForm.pdv}
                    disabled={!isSummaryEditing}
                    onChange={(event) =>
                      setClientSummaryForm((prev) => ({ ...prev, pdv: event.target.value }))
                    }
                  />
                </label>
                <label>
                  SEGURO
                  <input
                    type="text"
                    inputMode="numeric"
                    value={clientSummaryForm.seguro}
                    disabled={!isSummaryEditing}
                    onChange={(event) =>
                      setClientSummaryForm((prev) => ({
                        ...prev,
                        seguro: formatCurrencyInput(event.target.value),
                      }))
                    }
                    placeholder="R$ 0,00"
                  />
                </label>
              </div>
              {isSummaryEditing ? (
                <div className="row">
                  <button type="button" className="primary-button" onClick={() => void onSaveClientSummary()}>
                    Salvar
                  </button>
                </div>
              ) : null}
            </section>
            <div className="loan-history">
              <div className="section-header-row">
                <h4>Histórico</h4>
              </div>
              <div className="loan-history-filters">
                <button
                  type="button"
                  className={`loan-history-filter-button ${timelineFilter === "all" ? "active" : ""}`}
                  onClick={() => setTimelineFilter("all")}
                >
                  Todos ({timelineCounts.all})
                </button>
                <button
                  type="button"
                  className={`loan-history-filter-button ${timelineFilter === "activity" ? "active" : ""}`}
                  onClick={() => setTimelineFilter("activity")}
                >
                  Atividades ({timelineCounts.activity})
                </button>
                <button
                  type="button"
                  className={`loan-history-filter-button ${timelineFilter === "status" ? "active" : ""}`}
                  onClick={() => setTimelineFilter("status")}
                >
                  Status ({timelineCounts.status})
                </button>
                <button
                  type="button"
                  className={`loan-history-filter-button ${timelineFilter === "agenda" ? "active" : ""}`}
                  onClick={() => setTimelineFilter("agenda")}
                >
                  Agenda ({timelineCounts.agenda})
                </button>
                <button
                  type="button"
                  className={`loan-history-filter-button ${timelineFilter === "simulation" ? "active" : ""}`}
                  onClick={() => setTimelineFilter("simulation")}
                >
                  Simulações ({timelineCounts.simulation})
                </button>
                <button
                  type="button"
                  className={`loan-history-filter-button ${timelineFilter === "loss" ? "active" : ""}`}
                  onClick={() => setTimelineFilter("loss")}
                >
                  Perdas ({timelineCounts.loss})
                </button>
                <button
                  type="button"
                  className={`loan-history-filter-button ${timelineFilter === "client" ? "active" : ""}`}
                  onClick={() => setTimelineFilter("client")}
                >
                  Cliente ({timelineCounts.client})
                </button>
                <button
                  type="button"
                  className={`loan-history-filter-button ${timelineFilter === "event" ? "active" : ""}`}
                  onClick={() => setTimelineFilter("event")}
                >
                  Eventos ({timelineCounts.event})
                </button>
              </div>
              {filteredTimelineItems.length === 0 ? (
                <p className="muted-text">Sem registros para este cliente.</p>
              ) : (
                filteredTimelineItems.map((item) => {
                  const meta = getTimelineMeta(item);
                  const metaLine = [
                    new Date(item.createdAt).toLocaleString("pt-BR"),
                    item.actorUserName ?? null,
                    item.scheduledFor ? `Agendado para: ${new Date(item.scheduledFor).toLocaleString("pt-BR")}` : null,
                    item.completedAt ? `Concluído em: ${new Date(item.completedAt).toLocaleString("pt-BR")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" - ");
                  return (
                    <article key={item.id} className={`loan-history-item ${meta.className}`}>
                      <div className="loan-history-head loan-history-head-single-line">
                        <span className={`loan-history-chip ${meta.className}`}>{meta.label}</span>
                        <strong className="loan-history-title-inline">{item.title}</strong>
                        {item.description ? (
                          <span className="loan-history-description-inline" title={item.description}>
                            {item.description}
                          </span>
                        ) : null}
                        <small className="loan-history-meta-inline">{metaLine}</small>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      ) : null}
      {isClientDetailsModalOpen && selectedClient && isLostReasonModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-template" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h3>Motivo da perda</h3>
              <button
                type="button"
                onClick={() => {
                  setIsLostReasonModalOpen(false);
                  setLostHasMargin("");
                }}
              >
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
                Possui margem?
                <select
                  value={lostHasMargin}
                  onChange={(event) => setLostHasMargin(event.target.value as "" | "sim" | "nao")}
                  required
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </select>
              </label>
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
      {isClientDetailsModalOpen && selectedClient && isCycleHistoryModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-template" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h3>Histórico de ciclos do funil</h3>
              <button type="button" onClick={() => setIsCycleHistoryModalOpen(false)}>
                X
              </button>
            </div>
            <div className="loan-opportunity-history">
              {opportunities.length === 0 ? (
                <p className="muted-text">Nenhum ciclo encontrado para este cliente.</p>
              ) : (
                <div className="loan-opportunity-history-list">
                  {opportunities.map((cycle) => (
                    <article key={cycle.id} className="loan-opportunity-history-card">
                      <div className="loan-opportunity-history-head">
                        <strong>Ciclo #{cycle.cycleNumber}</strong>
                        <span>
                          {cycle.outcome === "ganho"
                            ? "Fechado como ganho"
                            : cycle.outcome === "perdido"
                              ? "Fechado como perdido"
                              : "Em andamento"}
                        </span>
                      </div>
                      <p>
                        <strong>Status:</strong> {getStatusLabel(cycle.status)}
                      </p>
                      <p>
                        <strong>Origem:</strong> {cycle.source || "-"}
                      </p>
                      <p>
                        <strong>Vendedor:</strong> {cycle.assignedUserName || "-"}
                      </p>
                      <p>
                        <strong>Início:</strong> {new Date(cycle.openedAt).toLocaleString("pt-BR")}
                      </p>
                      <p>
                        <strong>Fechamento:</strong>{" "}
                        {cycle.closedAt ? new Date(cycle.closedAt).toLocaleString("pt-BR") : "Ainda aberto"}
                      </p>
                      {cycle.outcome === "perdido" ? (
                        <p>
                          <strong>Motivo da perda:</strong> {cycle.lossReason || "Não informado"}
                          {cycle.lossHasMargin !== null
                            ? ` | Possui margem: ${cycle.lossHasMargin ? "Sim" : "Não"}`
                            : ""}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
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
                    clientId: "",
                    scheduledFor: prev.scheduledFor || getDefaultScheduleDateTimeLocal(),
                  }));
                  setQuickAgendaClientQuery("");
                  setQuickAgendaClientResults([]);
                  setIsQuickAgendaClientDropdownOpen(false);
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
                  onOpenAgendaDetailsModal(item);
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
                  <tr
                    key={item.id}
                    className="loan-agenda-row-clickable"
                    onClick={() => onOpenAgendaDetailsModal(item)}
                  >
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
                          title="Ver detalhes do agendamento"
                          aria-label="Ver detalhes do agendamento"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenAgendaDetailsModal(item);
                          }}
                        >
                          <OpenClientIcon />
                        </button>
                        <button
                          type="button"
                          className={`loan-agenda-action-button ${item.completedAt ? "is-done" : "is-pending"}`}
                          title={item.completedAt ? "Concluído" : "Concluir"}
                          disabled={Boolean(item.completedAt) || loadingAgendaCompleteId === item.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void onConcluirAgendaItem(item);
                          }}
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
              <button
                type="button"
                onClick={() => {
                  setIsQuickAgendaModalOpen(false);
                  setIsQuickAgendaClientDropdownOpen(false);
                }}
              >
                X
              </button>
            </div>
            <form className="modal-form" onSubmit={onCreateQuickAgenda}>
              <label>
                Cliente (nome ou CPF)
                <div className="quick-agenda-client-combobox">
                  <input
                    type="text"
                    placeholder="Digite nome ou CPF para buscar"
                    value={quickAgendaClientQuery}
                    onFocus={() => setIsQuickAgendaClientDropdownOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setIsQuickAgendaClientDropdownOpen(false), 120);
                    }}
                    onChange={(event) => {
                      const value = event.target.value;
                      setQuickAgendaClientQuery(value);
                      setQuickAgendaForm((prev) => ({ ...prev, clientId: "" }));
                      setIsQuickAgendaClientDropdownOpen(true);
                    }}
                  />
                  {isQuickAgendaClientDropdownOpen ? (
                    <div className="quick-agenda-client-combobox-list">
                      {quickAgendaClientQuery.trim().length < 2 ? (
                        <div className="quick-agenda-client-combobox-empty">Digite ao menos 2 caracteres.</div>
                      ) : isLoadingQuickAgendaClients ? (
                        <div className="quick-agenda-client-combobox-empty">Buscando clientes...</div>
                      ) : quickAgendaClientResults.length === 0 ? (
                        <div className="quick-agenda-client-combobox-empty">Nenhum cliente encontrado.</div>
                      ) : (
                        quickAgendaClientResults.map((client) => (
                          <button
                            key={`quick-agenda-client-${client.id}`}
                            type="button"
                            className="quick-agenda-client-combobox-item"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setQuickAgendaForm((prev) => ({ ...prev, clientId: String(client.id) }));
                              setQuickAgendaClientQuery(
                                `${client.name}${client.cpf ? ` - CPF ${client.cpf}` : ""}`,
                              );
                              setIsQuickAgendaClientDropdownOpen(false);
                            }}
                          >
                            <span>{client.name}</span>
                            <small>{client.cpf || "-"}</small>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
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

      {loanSection === "agenda" && selectedAgendaItem ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h3>Detalhes do agendamento</h3>
              <button type="button" onClick={onCloseAgendaDetailsModal}>
                X
              </button>
            </div>
            <div className="form-stack">
              <p>
                <strong>Cliente:</strong> {selectedAgendaItem.clientName}
              </p>
              <p>
                <strong>Data e hora:</strong> {new Date(selectedAgendaItem.scheduledFor).toLocaleString("pt-BR")}
              </p>
              <p>
                <strong>Status:</strong>{" "}
                {statusFlow.find((status) => status.key === selectedAgendaItem.status)?.label ?? selectedAgendaItem.status}
              </p>
              <p>
                <strong>Vendedor:</strong> {selectedAgendaItem.assignedUserName || "-"}
              </p>
              <p>
                <strong>Canal:</strong> {getChannelLabel(selectedAgendaItem.channel)}
              </p>
              <p>
                <strong>Situação:</strong> {selectedAgendaItem.completedAt ? "Concluído" : "Pendente"}
              </p>
              <p>
                <strong>Observação:</strong> {selectedAgendaItem.notes?.trim() || "-"}
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={onCloseAgendaDetailsModal}>
                Fechar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void onOpenAgendaClient(selectedAgendaItem);
                  onCloseAgendaDetailsModal();
                }}
              >
                Abrir card
              </button>
            </div>
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
              <th>CPF</th>
              <th>Margem atual R$</th>
              <th>Status</th>
              <th>Cadastrar</th>
            </tr>
          </thead>
          <tbody>
            {servidoresImportados.length === 0 ? (
              <tr>
                <td colSpan={6}>
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
                        </div>
                      </td>
                      <td>{item.name}</td>
                      <td>{item.seconsigCpf ? formatCpf(item.seconsigCpf) : "-"}</td>
                      <td>
                        {item.seconsigMargemAtual !== undefined && item.seconsigMargemAtual !== null
                          ? formatCurrency(Number(item.seconsigMargemAtual))
                          : "-"}
                      </td>
                      <td>{item.seconsigStatus || "-"}</td>
                      <td>
                        <button type="button" onClick={() => onCadastrarServidor(item)}>
                          Cadastrar
                        </button>
                      </td>
                    </tr>
                    {expandido ? (
                      <tr className="details-row">
                        <td colSpan={6}>
                          <div className="details-grid details-grid-importados">
                            <div className="detail-item detail-item-rubricas">
                              <strong>Rubricas</strong>
                              {item.rubricas && item.rubricas.length > 0 ? (
                                <div className="rubricas-table-wrap">
                                  <div className="rubricas-table-header">
                                    <span>Rubrica</span>
                                    <span>Tipo</span>
                                    <span className="rubricas-value-col">Valor</span>
                                  </div>
                                  <div className="rubricas-table-body">
                                    {item.rubricas.map((rubrica, index) => {
                                      const tipoRaw = String(rubrica.tipo ?? "").trim().toLocaleLowerCase("pt-BR");
                                      const tipo =
                                        tipoRaw.includes("desc") || tipoRaw.includes("debit") || tipoRaw === "d"
                                          ? "Desconto"
                                          : "Receita";
                                      return (
                                        <div key={`${item.id}-${rubrica.nome}-${index}`} className="rubricas-table-row">
                                          <span className="rubrica-name">{rubrica.nome || "-"}</span>
                                          <span
                                            className={
                                              tipo === "Desconto"
                                                ? "rubrica-type rubrica-type-desconto"
                                                : "rubrica-type rubrica-type-receita"
                                            }
                                          >
                                            {tipo}
                                          </span>
                                          <span className="rubrica-value">{formatCurrency(Math.abs(Number(rubrica.valor ?? 0)))}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="rubricas-summary">
                                    <div className="rubricas-summary-row">
                                      <span>Valor bruto</span>
                                      <strong>{formatCurrency(Number(item.valorBruto ?? 0))}</strong>
                                    </div>
                                    <div className="rubricas-summary-row rubricas-summary-row-highlight">
                                      <span>Valor líquido</span>
                                      <strong>{formatCurrency(Number(item.valorLiquido ?? 0))}</strong>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <span>-</span>
                              )}
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
                              <strong>Cargo</strong>
                              <span>{item.cargo || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Unidade gestora</strong>
                              <span>{item.unidadeGestora || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Matrícula</strong>
                              <span>{item.sourceExternalId || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>CPF</strong>
                              <span>{item.seconsigCpf ? formatCpf(item.seconsigCpf) : "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Margem atual R$</strong>
                              <span>
                                {item.seconsigMargemAtual !== undefined && item.seconsigMargemAtual !== null
                                  ? formatCurrency(Number(item.seconsigMargemAtual))
                                  : "-"}
                              </span>
                            </div>
                            <div className="detail-item">
                              <strong>Status</strong>
                              <span>{item.seconsigStatus || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Admissao</strong>
                              <span>{item.dataAdmissao || "-"}</span>
                            </div>
                            <div className="detail-item">
                              <strong>Periodo de folha</strong>
                              <span>
                                {String(item.mes).padStart(2, "0")}/{item.ano}
                              </span>
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
                CEP
                <input
                  value={clientForm.cep}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, cep: formatCep(event.target.value) }))}
                  placeholder="00000-000"
                />
                {isLoadingCep ? <small>Buscando CEP...</small> : null}
                {!isLoadingCep && cepLookupMessage ? <small>{cepLookupMessage}</small> : null}
              </label>
              <label>
                Endereço
                <input
                  value={clientForm.addressStreet}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, addressStreet: event.target.value }))}
                />
              </label>
              <label>
                Número
                <input
                  value={clientForm.addressNumber}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, addressNumber: event.target.value }))}
                />
              </label>
              <label>
                Complemento
                <input
                  value={clientForm.addressComplement}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, addressComplement: event.target.value }))}
                />
              </label>
              <label>
                Bairro
                <input
                  value={clientForm.addressNeighborhood}
                  onChange={(event) =>
                    setClientForm((prev) => ({ ...prev, addressNeighborhood: event.target.value }))
                  }
                />
              </label>
              <label>
                Cidade
                <input
                  value={clientForm.city}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, city: event.target.value }))}
                />
              </label>
              <label>
                UF
                <input
                  value={clientForm.addressState}
                  onChange={(event) =>
                    setClientForm((prev) => ({ ...prev, addressState: event.target.value.toUpperCase().slice(0, 2) }))
                  }
                  placeholder="UF"
                  maxLength={2}
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
            <div className="loan-report-actions">
              <label className="loan-report-month-filter">
                Competência
                <select
                  value={comissaoFiltro.monthRef}
                  onChange={(event) =>
                    setComissaoFiltro((prev) => ({ ...prev, monthRef: event.target.value }))
                  }
                >
                  {monthFilterOptions.map((item) => (
                    <option key={`comissao-month-${item.value || "all"}`} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="primary-button"
                onClick={() => void loadFunnelOutcomeReportData()}
                disabled={funnelOutcomeReportLoading}
              >
                {funnelOutcomeReportLoading ? "Atualizando..." : "Atualizar"}
              </button>
            </div>
          </div>
          <p className="section-subtitle">
            Cards ganhos entram automaticamente aqui para controle de comissionamento.
          </p>
          <div className="loan-metrics loan-report-metrics">
            <article>
              <strong>{commissionTotals.total}</strong>
              <span>Ganhos no período</span>
            </article>
            <article>
              <strong>{commissionTotals.pendente}</strong>
              <span>Pendentes</span>
            </article>
            <article>
              <strong>{commissionTotals.pago}</strong>
              <span>Pagos</span>
            </article>
            <article>
              <strong>{formatCurrency(commissionTotals.valorContratoTotal)}</strong>
              <span>Contrato total</span>
            </article>
            <article>
              <strong>{formatCurrency(commissionTotals.valorLiquidoTotal)}</strong>
              <span>Líquido total</span>
            </article>
          </div>
          <div className="loan-report-filters">
            <input
              placeholder="Buscar cliente (nome ou CPF)"
              value={comissaoFiltro.busca}
              onChange={(event) =>
                setComissaoFiltro((prev) => ({ ...prev, busca: event.target.value }))
              }
            />
            <select
              value={comissaoFiltro.vendedorId}
              onChange={(event) =>
                setComissaoFiltro((prev) => ({ ...prev, vendedorId: event.target.value }))
              }
            >
              <option value="">Todos os vendedores</option>
              {sellerOptions.map((seller) => (
                <option key={`comissao-seller-${seller.id}`} value={String(seller.id)}>
                  {seller.name}
                </option>
              ))}
            </select>
            <select
              value={comissaoFiltro.commissionStatus}
              onChange={(event) =>
                setComissaoFiltro((prev) => ({
                  ...prev,
                  commissionStatus: event.target.value as "" | "pendente" | "pago",
                }))
              }
            >
              <option value="">Status da comissão (todos)</option>
              <option value="pendente">Pendente</option>
              <option value="pago">Pago</option>
            </select>
            <button
              className="loan-filter-clear-button"
              type="button"
              onClick={() =>
                setComissaoFiltro((prev) => ({
                  monthRef: prev.monthRef,
                  busca: "",
                  vendedorId: "",
                  commissionStatus: "",
                }))
              }
            >
              Limpar filtros
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>CPF</th>
                  <th>Vendedor(a)</th>
                  <th>Valor contrato</th>
                  <th>Valor líquido</th>
                  <th>Prazo</th>
                  <th>Taxa de juros</th>
                  <th>Agência</th>
                  <th>Tipo contrato</th>
                  <th>PDV</th>
                  <th>Status comissão</th>
                  <th>Observações</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredCommissionItems.map((item) => {
                  const draft = commissionDrafts[item.opportunityId] ?? buildCommissionDraft(item);
                  const formatDraftMoney = (value: string): string => {
                    const parsed = parseLocaleNumber(value);
                    return parsed === null ? "-" : formatCurrency(parsed);
                  };
                  const formatDraftText = (value: string): string => {
                    const normalized = value.trim();
                    return normalized || "-";
                  };
                  return (
                    <tr key={`comissao-row-${item.opportunityId}`}>
                      <td>{item.name}</td>
                      <td>{item.cpf}</td>
                      <td>
                        {isAdmin ? (
                          <select
                            value={draft.assignedUserId}
                            onChange={(event) =>
                              setCommissionDrafts((current) => ({
                                ...current,
                                [item.opportunityId]: { ...draft, assignedUserId: event.target.value },
                              }))
                            }
                          >
                            <option value="">Selecione</option>
                            {sellerOptions.map((seller) => (
                              <option key={`comissao-row-seller-${item.opportunityId}-${seller.id}`} value={String(seller.id)}>
                                {seller.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          item.assignedUserName || "-"
                        )}
                      </td>
                      <td>{formatDraftMoney(draft.contractValue)}</td>
                      <td>{formatDraftMoney(draft.netValue)}</td>
                      <td>{formatDraftText(draft.termMonths)}</td>
                      <td>{formatDraftText(draft.interestRate)}</td>
                      <td>{formatDraftText(draft.agency)}</td>
                      <td>{formatDraftText(draft.contractType)}</td>
                      <td>{formatDraftText(draft.pdv)}</td>
                      <td>
                        <select
                          value={draft.commissionStatus}
                          onChange={(event) =>
                            setCommissionDrafts((current) => ({
                              ...current,
                              [item.opportunityId]: {
                                ...draft,
                                commissionStatus: event.target.value as "pendente" | "pago",
                              },
                            }))
                          }
                        >
                          <option value="pendente">Pendente</option>
                          <option value="pago">Pago</option>
                        </select>
                      </td>
                      <td>
                        <input
                          value={draft.notes}
                          onChange={(event) =>
                            setCommissionDrafts((current) => ({
                              ...current,
                              [item.opportunityId]: { ...draft, notes: event.target.value },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={updatingCommissionOpportunityId === item.opportunityId}
                          onClick={() => void onSaveCommissionData(item)}
                        >
                          {updatingCommissionOpportunityId === item.opportunityId ? "Salvando..." : "Salvar"}
                        </button>
                        {isAdmin ? (
                          <button
                            type="button"
                            className="danger-button"
                            disabled={updatingCommissionOpportunityId === item.opportunityId}
                            onClick={() => void onAdminExcluirGanho(item)}
                          >
                            Excluir
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {filteredCommissionItems.length === 0 ? (
                  <tr>
                    <td colSpan={14}>Nenhum card ganho encontrado para os filtros selecionados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {loanSection === "relatorios" ? (
        <section className="card">
          <div className="section-header-row">
            <h3 className="loan-title-icon-label">
              <MenuRelatoriosIcon />
              <span>Relatórios do Funil</span>
            </h3>
            <div className="loan-report-actions">
              <label className="loan-report-month-filter">
                Competência
                <select
                  value={relatoriosFiltro.monthRef}
                  onChange={(event) =>
                    setRelatoriosFiltro((prev) => ({ ...prev, monthRef: event.target.value }))
                  }
                >
                  {monthFilterOptions.map((item) => (
                    <option key={`relatorio-month-${item.value || "all"}`} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="primary-button"
                onClick={() => void loadFunnelOutcomeReportData()}
                disabled={funnelOutcomeReportLoading}
              >
                {funnelOutcomeReportLoading ? "Atualizando..." : "Atualizar"}
              </button>
              <button
                type="button"
                className="loan-report-export-button"
                onClick={onExportFunnelOutcomeReport}
                disabled={funnelOutcomeReportLoading || filteredFunnelOutcomeReportItems.length === 0}
              >
                Exportar Excel
              </button>
            </div>
          </div>
          <div className="loan-metrics loan-report-metrics">
            <article>
              <strong>{filteredFunnelOutcomeTotals.total}</strong>
              <span>Total no relatório</span>
            </article>
            <article>
              <strong>{filteredFunnelOutcomeTotals.ganho}</strong>
              <span>Ganhos</span>
            </article>
            <article>
              <strong>{filteredFunnelOutcomeTotals.perdido}</strong>
              <span>Perdas</span>
            </article>
          </div>
          <div className="loan-report-filters">
            <input
              placeholder="Buscar cliente (nome ou CPF)"
              value={relatoriosFiltro.busca}
              onChange={(event) =>
                setRelatoriosFiltro((prev) => ({ ...prev, busca: event.target.value }))
              }
            />
            <select
              value={relatoriosFiltro.hasMargin}
              onChange={(event) =>
                setRelatoriosFiltro((prev) => ({
                  ...prev,
                  hasMargin: event.target.value as "" | "sim" | "nao",
                }))
              }
            >
              <option value="">Possui margem? (todos)</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </select>
            <select
              value={relatoriosFiltro.status}
              onChange={(event) =>
                setRelatoriosFiltro((prev) => ({
                  ...prev,
                  status: event.target.value as "" | "ganho" | "perdido",
                }))
              }
            >
              <option value="">Status (todos)</option>
              <option value="ganho">Ganho</option>
              <option value="perdido">Perdido</option>
            </select>
            <select
              value={relatoriosFiltro.vendedorId}
              onChange={(event) =>
                setRelatoriosFiltro((prev) => ({ ...prev, vendedorId: event.target.value }))
              }
            >
              <option value="">Todos os vendedores</option>
              {sellerOptions.map((seller) => (
                <option key={`report-seller-${seller.id}`} value={String(seller.id)}>
                  {seller.name}
                </option>
              ))}
            </select>
            <select
              value={relatoriosFiltro.convenio}
              onChange={(event) =>
                setRelatoriosFiltro((prev) => ({ ...prev, convenio: event.target.value }))
              }
            >
              <option value="">Todos os convênios</option>
              {convenioOptions.map((convenio) => (
                <option key={`report-convenio-${convenio}`} value={convenio}>
                  {convenio}
                </option>
              ))}
            </select>
            <select
              value={relatoriosFiltro.source}
              onChange={(event) =>
                setRelatoriosFiltro((prev) => ({ ...prev, source: event.target.value }))
              }
            >
              <option value="">Todas as origens</option>
              {sourceOptions.map((source) => (
                <option key={`report-source-${source}`} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <button
              className="loan-filter-clear-button"
              type="button"
              onClick={() =>
                setRelatoriosFiltro({
                  monthRef: relatoriosFiltro.monthRef,
                  busca: "",
                  hasMargin: "",
                  status: "",
                  vendedorId: "",
                  convenio: "",
                  source: "",
                })
              }
            >
              Limpar filtros
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Nome</th>
                  <th>CPF</th>
                  <th>Telefones</th>
                  <th>Cidade</th>
                  <th>Profissão</th>
                  <th>Convênio</th>
                  <th>Renda</th>
                  <th>Origem</th>
                  <th>Vendedor</th>
                  <th>Atualizado em</th>
                  <th>Possui margem?</th>
                  <th>Motivo da perda</th>
                </tr>
              </thead>
              <tbody>
                {filteredFunnelOutcomeReportItems.map((item) => (
                  <tr key={`funnel-report-${item.opportunityId}`}>
                    <td>{item.status === "ganho" ? "Ganho" : "Perdido"}</td>
                    <td>{item.name}</td>
                    <td>{item.cpf}</td>
                    <td>{item.phones.length > 0 ? item.phones.join(", ") : "-"}</td>
                    <td>{item.city || "-"}</td>
                    <td>{item.profession || "-"}</td>
                    <td>{item.convenio || "-"}</td>
                    <td>{formatCurrency(Number(item.income || 0))}</td>
                    <td>{item.source || "-"}</td>
                    <td>{item.assignedUserName || "-"}</td>
                    <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString("pt-BR") : "-"}</td>
                    <td>
                      {isAdmin && item.status === "perdido" ? (
                        <select
                          value={item.lostHasMargin === null ? "" : item.lostHasMargin ? "sim" : "nao"}
                          disabled={updatingLossMarginClientId === item.id}
                          onChange={(event) => {
                            const value = event.target.value as "" | "sim" | "nao";
                            if (!value) return;
                            void onAdminChangeLossMargin(item, value);
                          }}
                        >
                          <option value="" disabled>
                            Selecione
                          </option>
                          <option value="sim">Sim</option>
                          <option value="nao">Não</option>
                        </select>
                      ) : item.lostHasMargin === null ? (
                        "-"
                      ) : item.lostHasMargin ? (
                        "Sim"
                      ) : (
                        "Não"
                      )}
                    </td>
                    <td>{item.lostReason || "-"}</td>
                  </tr>
                ))}
                {filteredFunnelOutcomeReportItems.length === 0 ? (
                  <tr>
                    <td colSpan={13}>Nenhum resultado encontrado para o filtro selecionado.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {isStageConfigOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-template" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h3>Configurar colunas do Funil</h3>
              <button
                type="button"
                onClick={() => {
                  if (!isSavingStageConfig) setIsStageConfigOpen(false);
                }}
              >
                X
              </button>
            </div>
            <p className="section-subtitle">
              Organização global para todos os usuários. Para excluir uma coluna, ela deve estar sem clientes.
            </p>
            <div className="loan-stage-config-list">
              {stageConfigItems.map((item, index) => (
                <div key={`stage-config-${item.key}`} className="loan-stage-config-row">
                  <input
                    value={item.label}
                    onChange={(event) =>
                      setStageConfigItems((current) =>
                        current.map((entry) =>
                          entry.key === item.key ? { ...entry, label: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Nome da coluna"
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={item.active}
                      onChange={(event) =>
                        setStageConfigItems((current) =>
                          current.map((entry) =>
                            entry.key === item.key ? { ...entry, active: event.target.checked } : entry,
                          ),
                        )
                      }
                    />
                    Ativa
                  </label>
                  <button
                    type="button"
                    className="transaction-icon-button"
                    onClick={() => onMoveStageConfigItem(index, -1)}
                    disabled={index === 0}
                    title="Mover para cima"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="transaction-icon-button"
                    onClick={() => onMoveStageConfigItem(index, 1)}
                    disabled={index === stageConfigItems.length - 1}
                    title="Mover para baixo"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="transaction-icon-button danger"
                    onClick={() => void onDeleteStageConfigItem(item.key)}
                    title="Excluir coluna"
                    disabled={isSavingStageConfig}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
            <div className="loan-stage-config-create-row">
              <input
                value={newStageLabel}
                onChange={(event) => setNewStageLabel(event.target.value)}
                placeholder="Nome da nova coluna"
              />
              <button
                type="button"
                className="primary-button"
                onClick={() => void onCreateStageConfigItem()}
                disabled={isSavingStageConfig || !newStageLabel.trim()}
              >
                Adicionar coluna
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setIsStageConfigOpen(false)} disabled={isSavingStageConfig}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void onSaveStageConfig()}
                disabled={isSavingStageConfig}
              >
                {isSavingStageConfig ? "Salvando..." : "Salvar colunas"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {isAdmin && isLoanSettingsModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-loan-seller" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h3>Configurar taxas</h3>
              <button
                type="button"
                onClick={() => {
                  if (!isSavingLoanSettings) setIsLoanSettingsModalOpen(false);
                }}
              >
                X
              </button>
            </div>
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveLoanSettings();
              }}
            >
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
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setIsLoanSettingsModalOpen(false)}
                  disabled={isSavingLoanSettings}
                >
                  Cancelar
                </button>
                <button type="submit" className="primary-button" disabled={isSavingLoanSettings}>
                  {isSavingLoanSettings ? "Salvando..." : "Salvar configurações"}
                </button>
              </div>
            </form>
          </section>
        </div>
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
