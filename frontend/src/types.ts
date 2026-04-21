export type Role = "admin" | "employee";

export type User = {
  id: number;
  name: string;
  email: string;
  role: Role;
  groupIds: number[];
  menuVisibility: {
    senhas: boolean;
    transacional: boolean;
    negocial: boolean;
  };
};

export type ManagedUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  groupIds: number[];
  menuVisibility: {
    senhas: boolean;
    transacional: boolean;
    negocial: boolean;
  };
};

export type Group = {
  id: number;
  name: string;
};

export type ExtraField = {
  name: string;
  value: string;
};

export type Credential = {
  id: number;
  systemName: string;
  accessMode: "web" | "vpn";
  linkUrl: string;
  username: string;
  password: string;
  updatedAt: string;
  updatedByName: string;
  groupIds: number[];
  extraFields: ExtraField[];
};

export type LoanClientStatus =
  | "novo"
  | "em_atendimento"
  | "simulacao"
  | "em_analise"
  | "digitacao"
  | "seguro_ap"
  | "assinatura"
  | "pagamento"
  | "ganho"
  | "perdido";

export type LoanProductType = "credito" | "seguros" | "capitalizacao" | "imobiliario";

export type LoanClient = {
  id: number;
  name: string;
  cpf: string;
  city: string;
  profession: string;
  convenio: string;
  income: number;
  heatBadge: "Quente" | "Morno" | "Frio" | null;
  status: LoanClientStatus;
  source: string;
  assignedUserId: number | null;
  assignedUserName: string | null;
  createdAt: string;
  updatedAt: string;
  lastContactAt: string | null;
  phones: string[];
};

export type LoanInteraction = {
  id: number;
  clientId: number;
  notes: string;
  channel: string;
  scheduledFor?: string | null;
  completedAt?: string | null;
  createdAt: string;
  userName?: string;
};

export type LoanAgendaItem = {
  id: number;
  clientId: number;
  clientName: string;
  status: LoanClientStatus;
  assignedUserId: number | null;
  assignedUserName: string | null;
  channel: string;
  notes: string;
  scheduledFor: string;
  completedAt: string | null;
  createdAt: string;
};

export type LoanProduct = {
  id: number;
  name: string;
  productType: LoanProductType;
  defaultRate: number;
  minTerm: number;
  maxTerm: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LoanSimulation = {
  id: number;
  clientId: number;
  productId: number | null;
  productType: LoanProductType;
  principal: number;
  installments: number;
  monthlyRate: number;
  installmentValue: number;
  totalPaid: number;
  effectiveCost: number;
  isBest: boolean;
  createdAt: string;
};

export type LoanDashboard = {
  totalClients: number;
  conversions: number;
  wonClients: number;
  lostClients: number;
  noContactClients: number;
  statusBreakdown: Array<{ status: LoanClientStatus; total: number }>;
  interactionsByDay: Array<{ day: string; total: number }>;
  productsMostSold: Array<{ product_type: LoanProductType; total: number }>;
};

export type ImportedServant = {
  id: number;
  sourceExternalId: string;
  name: string;
  cargo: string;
  unidadeGestora: string;
  lotacao: string;
  mes: number;
  ano: number;
  valorLiquido: number;
  valorBruto: number;
  descontos: number;
  dataAdmissao: string;
  regime: string;
  vinculo: string;
  margemMaxima: number;
  margemUtilizada: number;
  margemDisponivel: number;
  classificacaoMargem: "Alta" | "Media" | "Baixa";
  score: number;
  classificacaoScore: "Quente" | "Morno" | "Frio";
  valorMaximoLiberado: number;
  melhorParcela: number;
  melhorPrazo: number;
  totalPago: number;
  produtoRecomendado: string;
  motivoRecomendacao: string;
  prioridadeAtendimento: "Alta" | "Media" | "Baixa";
  classificacaoConsignado: "Com consignado" | "Sem consignado";
  rubricas: Array<{
    nome: string;
    valor: number;
  }>;
  importedAt: string;
};

export type TransactionDay = {
  id: number;
  terminalId: number;
  terminalCode: string;
  date: string;
  authCount: number;
  saqueCount: number;
  pixSaqueCount: number;
  recargaValue: number;
  updatedAt: string;
};

export type TransactionTerminal = {
  id: number;
  code: string;
  name: string;
  active: boolean;
};

export type TransactionMonthTotals = {
  authCount: number;
  saqueCount: number;
  pixSaqueCount: number;
  recargaValue: number;
};

export type TransactionMonthData = {
  monthRef: string;
  terminals: TransactionTerminal[];
  items: TransactionDay[];
  totals: TransactionMonthTotals;
  byTerminal: Array<{
    terminalId: number;
    terminalCode: string;
    authCount: number;
    saqueCount: number;
    pixSaqueCount: number;
    recargaValue: number;
  }>;
};

export type TransactionMonthSummary = {
  monthRef: string;
  daysCount: number;
  authCount: number;
  saqueCount: number;
  pixSaqueCount: number;
  recargaValue: number;
};

export type ContactPhone = {
  id: number;
  phone: string;
  hasWhatsapp: boolean;
};

export type Contact = {
  id: number;
  name: string;
  company: string;
  sector: string;
  cargo: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  phones: ContactPhone[];
};

export type FinanceEntryType = "receita" | "despesa";

export type FinanceEntry = {
  id: number;
  type: FinanceEntryType;
  description: string;
  category: string;
  amount: number;
  entryDate: string;
  dueDate: string | null;
  referenceMonth: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  templateId: number | null;
  installmentGroupKey?: string | null;
  installmentIndex?: number | null;
  installmentTotal?: number | null;
  status: "pago" | "pendente" | "atrasado";
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type FinanceTotals = {
  receitas: number;
  despesas: number;
  saldo: number;
};

export type FinanceExpenseTemplate = {
  id: number;
  description: string;
  category: string;
  defaultAmount: number;
  dueDay: number;
  startMonth?: string | null;
  isVariable: boolean;
  active: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentCertidaoTipo = "CNDT" | "CNF" | "CRF";

export type DocumentCertidaoStatus = "valida" | "vencendo" | "vencida" | "pendente" | "falha";

export type DocumentCertificateConfig = {
  cnpj: string;
  runnerMode: "backend" | "agent";
  certificateName: string | null;
  certificateExpiresAt: string | null;
  certificateUpdatedAt: string | null;
};

export type DocumentCertidao = {
  certType: DocumentCertidaoTipo;
  status: DocumentCertidaoStatus;
  issueDate: string | null;
  expiryDate: string | null;
  controlCode: string | null;
  sourceUrl: string | null;
  storagePath: string | null;
  fileHash: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};
