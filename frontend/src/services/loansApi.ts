import {
  LoanClient,
  LoanClientStatus,
  LoanDashboard,
  LoanFunnelOutcomeReport,
  LoanAgendaItem,
  ImportedServant,
  LoanInteraction,
  LoanOpportunity,
  LoanTimelineItem,
  LoanProduct,
  LoanProductType,
  LoanPipelineStage,
  LoanSimulation,
} from "../types";
import { http } from "./http";

export async function listLoanClients(query?: {
  search?: string;
  monthRef?: string;
  status?: LoanClientStatus;
  source?: string;
  convenio?: string;
  assignedUserId?: number;
  sortBy?: "name" | "cpf" | "city" | "profession" | "convenio" | "assignedUserName" | "status" | "updatedAt";
  sortDir?: "asc" | "desc";
  page?: number;
  limit?: number;
}): Promise<{
  items: LoanClient[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const { data } = await http.get<{
    items: LoanClient[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>("/loans/clients", {
    params: query,
  });
  return data;
}

export async function createLoanClient(payload: {
  name: string;
  cpf: string;
  phones: string[];
  city: string;
  profession: string;
  convenio: string;
  income: number;
  heatBadge?: "Quente" | "Morno" | "Frio" | null;
  source: string;
  status: LoanClientStatus;
  assignedUserId?: number;
}): Promise<{ id: number }> {
  const { data } = await http.post<{ id: number }>("/loans/clients", payload);
  return data;
}

export async function updateLoanClientStatus(
  id: number,
  status: LoanClientStatus,
): Promise<void> {
  await http.patch(`/loans/clients/${id}/status`, { status });
}

export async function updateLoanClientHeatBadge(
  id: number,
  heatBadge: "Quente" | "Morno" | "Frio" | null,
): Promise<void> {
  await http.patch(`/loans/clients/${id}/heat-badge`, { heatBadge });
}

export async function deleteLoanClient(id: number): Promise<void> {
  await http.delete(`/loans/clients/${id}`);
}

export async function updateLoanClient(
  id: number,
  payload: {
    name: string;
    cpf: string;
    phones: string[];
    city: string;
    profession: string;
    convenio: string;
    income: number;
    heatBadge?: "Quente" | "Morno" | "Frio" | null;
    source: string;
    status: LoanClientStatus;
    assignedUserId?: number;
  },
): Promise<void> {
  await http.put(`/loans/clients/${id}`, payload);
}

export async function getLoanClientById(id: number): Promise<LoanClient> {
  const { data } = await http.get<LoanClient>(`/loans/clients/${id}`);
  return data;
}

export async function listLoanSellers(): Promise<Array<{ id: number; name: string; email: string }>> {
  const { data } = await http.get<Array<{ id: number; name: string; email: string }>>("/loans/sellers");
  return data;
}

export async function listLoanInteractions(clientId: number): Promise<LoanInteraction[]> {
  const { data } = await http.get<LoanInteraction[]>(`/loans/clients/${clientId}/interactions`);
  return data;
}

export async function listLoanOpportunities(clientId: number): Promise<LoanOpportunity[]> {
  const { data } = await http.get<LoanOpportunity[]>(`/loans/clients/${clientId}/opportunities`);
  return data;
}

export async function listLoanTimeline(clientId: number): Promise<LoanTimelineItem[]> {
  const { data } = await http.get<LoanTimelineItem[]>(`/loans/clients/${clientId}/timeline`);
  return data;
}

export async function createLoanInteraction(
  clientId: number,
  payload: { notes: string; channel: string; scheduledFor?: string | null },
): Promise<LoanInteraction> {
  const { data } = await http.post<LoanInteraction>(
    `/loans/clients/${clientId}/interactions`,
    payload,
  );
  return data;
}

export async function listLoanAgenda(query?: {
  monthRef?: string;
  status?: "all" | "pending" | "completed";
}): Promise<LoanAgendaItem[]> {
  const { data } = await http.get<LoanAgendaItem[]>("/loans/agenda", {
    params: query,
  });
  return data;
}

export async function completeLoanAgendaItem(agendaId: number): Promise<void> {
  await http.patch(`/loans/agenda/${agendaId}/complete`);
}

export async function rescheduleLoanAgendaItem(agendaId: number, scheduledFor: string): Promise<void> {
  await http.patch(`/loans/agenda/${agendaId}/reschedule`, { scheduledFor });
}

export async function listLoanSimulations(clientId: number): Promise<LoanSimulation[]> {
  const { data } = await http.get<LoanSimulation[]>(`/loans/clients/${clientId}/simulations`);
  return data;
}

export async function createLoanSimulation(
  clientId: number,
  payload: {
    productId: number | null;
    productType: LoanProductType;
    principal: number;
    installments: number;
    monthlyRate: number;
  },
): Promise<LoanSimulation> {
  const { data } = await http.post<LoanSimulation>(
    `/loans/clients/${clientId}/simulations`,
    payload,
  );
  return data;
}

export async function markLoanClientActivityTouch(
  clientId: number,
  channel: "whatsapp" | "simulation",
): Promise<void> {
  await http.post(`/loans/clients/${clientId}/activity-touch`, { channel });
}

export async function updateLoanClientLossMargin(clientId: number, hasMargin: boolean): Promise<void> {
  await http.patch(`/loans/clients/${clientId}/loss-margin`, { hasMargin });
}

export async function listLoanProducts(): Promise<LoanProduct[]> {
  const { data } = await http.get<LoanProduct[]>("/loans/products");
  return data;
}

export async function createLoanProduct(payload: {
  name: string;
  productType: LoanProductType;
  defaultRate: number;
  minTerm: number;
  maxTerm: number;
  active: boolean;
}): Promise<{ id: number }> {
  const { data } = await http.post<{ id: number }>("/loans/products", payload);
  return data;
}

export async function importLoanLeads(payload: {
  source: string;
  leads: Array<{
    name: string;
    cpf: string;
    phones: string[];
    city: string;
    profession: string;
    convenio: string;
    income: number;
    source: string;
    status: LoanClientStatus;
  }>;
}): Promise<{ totalRows: number; importedRows: number; duplicateRows: number }> {
  const { data } = await http.post<{
    totalRows: number;
    importedRows: number;
    duplicateRows: number;
  }>("/loans/imports", payload);
  return data;
}

export async function getLoanDashboard(query?: { monthRef?: string }): Promise<LoanDashboard> {
  const { data } = await http.get<LoanDashboard>("/loans/dashboard", {
    params: query,
  });
  return data;
}

export async function getLoanFunnelOutcomeReport(query?: { monthRef?: string }): Promise<LoanFunnelOutcomeReport> {
  const { data } = await http.get<LoanFunnelOutcomeReport>("/loans/reports/funnel-outcomes", {
    params: query,
  });
  return data;
}

export async function listLoanPipelineStages(): Promise<LoanPipelineStage[]> {
  const { data } = await http.get<LoanPipelineStage[]>("/loans/pipeline-stages");
  return data;
}

export async function createLoanPipelineStage(label: string): Promise<{ key: string; label: string; active: boolean }> {
  const { data } = await http.post<{ key: string; label: string; active: boolean }>("/loans/pipeline-stages", { label });
  return data;
}

export async function updateLoanPipelineStages(
  stages: Array<{ key: string; label: string; active: boolean }>,
): Promise<LoanPipelineStage[]> {
  const { data } = await http.put<LoanPipelineStage[]>("/loans/pipeline-stages", { stages });
  return data;
}

export async function deleteLoanPipelineStage(key: string): Promise<void> {
  await http.delete(`/loans/pipeline-stages/${encodeURIComponent(key)}`);
}

export async function importarServidoresPortal(payload: {
  ano: number;
  mes: number;
  nome?: string;
  tamanho?: number;
  maxPaginas?: number;
}): Promise<{
  jobId: string;
  status: "running";
}> {
  const { data } = await http.post<{
    jobId: string;
    status: "running";
  }>("/api/importar-servidores", payload);
  return data;
}

export async function getProgressoImportacaoServidores(jobId: string): Promise<{
  jobId: string;
  status: "running" | "completed" | "failed";
  processados: number;
  estimadoTotal: number;
  importados: number;
  comConsignado: number;
  semConsignado: number;
  duplicados: number;
  erros: number;
  errorMessage?: string;
}> {
  const { data } = await http.get<{
    jobId: string;
    status: "running" | "completed" | "failed";
    processados: number;
    estimadoTotal: number;
    importados: number;
    comConsignado: number;
    semConsignado: number;
    duplicados: number;
    erros: number;
    errorMessage?: string;
  }>(`/api/importar-servidores/progresso/${jobId}`);
  return data;
}

export async function listServidoresImportados(query?: {
  nome?: string;
  rubrica?: string;
  ano?: number;
  mes?: number;
  classificacao?: "Com consignado" | "Sem consignado";
  classificacaoMargem?: "Alta" | "Media" | "Baixa";
  classificacaoScore?: "Quente" | "Morno" | "Frio";
  prioridadeAtendimento?: "Alta" | "Media" | "Baixa";
  page?: number;
  limit?: number;
}): Promise<{
  items: ImportedServant[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const { data } = await http.get<{
    items: ImportedServant[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>("/api/servidores-importados", {
    params: query,
  });
  return data;
}

export async function listRubricasDescontoServidores(): Promise<Array<{ nome: string; total: number }>> {
  const { data } = await http.get<{
    items: Array<{ nome: string; total: number }>;
  }>("/api/servidores-importados/rubricas");
  return data.items;
}

export async function getLoanSettings(): Promise<{
  consignableMarginPercent: number;
  consignadoRate: number;
  pessoalRate: number;
}> {
  const { data } = await http.get<{
    consignableMarginPercent: number;
    consignadoRate: number;
    pessoalRate: number;
  }>("/loans/settings");
  return data;
}

export async function updateLoanSettings(payload: {
  consignableMarginPercent?: number;
  consignadoRate?: number;
  pessoalRate?: number;
}): Promise<{
  consignableMarginPercent: number;
  consignadoRate: number;
  pessoalRate: number;
}> {
  const { data } = await http.put<{
    consignableMarginPercent: number;
    consignadoRate: number;
    pessoalRate: number;
  }>("/loans/settings", payload);
  return data;
}

export async function simularServidorAgora(id: number): Promise<{
  valorMaximoLiberado: number;
  melhorParcela: number;
  melhorPrazo: number;
  totalPago: number;
  produtoRecomendado: string;
  prioridadeAtendimento: "Alta" | "Media" | "Baixa";
}> {
  const { data } = await http.post<{
    valorMaximoLiberado: number;
    melhorParcela: number;
    melhorPrazo: number;
    totalPago: number;
    produtoRecomendado: string;
    prioridadeAtendimento: "Alta" | "Media" | "Baixa";
  }>(`/api/servidores-importados/${id}/simular`);
  return data;
}
