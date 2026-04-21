export const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  can_view_senhas BOOLEAN NOT NULL DEFAULT TRUE,
  can_view_transacional BOOLEAN NOT NULL DEFAULT TRUE,
  can_view_negocial BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS can_view_senhas BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS can_view_transacional BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS can_view_negocial BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS credentials (
  id SERIAL PRIMARY KEY,
  system_name TEXT NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'web',
  link_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  extra_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (system_name, username)
);

ALTER TABLE credentials
ADD COLUMN IF NOT EXISTS extra_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE credentials
ADD COLUMN IF NOT EXISTS link_url TEXT NOT NULL DEFAULT '';

ALTER TABLE credentials
ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'web';

ALTER TABLE credentials
ALTER COLUMN access_mode SET DEFAULT 'web';

UPDATE credentials
SET access_mode = 'web'
WHERE access_mode = 'online';

UPDATE audit_logs
SET details = jsonb_set(details, '{accessMode}', '"web"'::jsonb, false)
WHERE details IS NOT NULL
  AND details ? 'accessMode'
  AND details->>'accessMode' = 'online';

CREATE TABLE IF NOT EXISTS credential_groups (
  credential_id INT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (credential_id, group_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INT REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  cargo TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES users(id),
  updated_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS cargo TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS contact_phones (
  id SERIAL PRIMARY KEY,
  contact_id INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  has_whatsapp BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_phones_contact_phone ON contact_phones(contact_id, phone);
CREATE INDEX IF NOT EXISTS idx_contact_phones_phone ON contact_phones(phone);

CREATE TABLE IF NOT EXISTS loan_clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cpf TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL DEFAULT '',
  profession TEXT NOT NULL DEFAULT '',
  convenio TEXT NOT NULL DEFAULT '',
  income NUMERIC(14,2) NOT NULL DEFAULT 0,
  heat_badge TEXT CHECK (heat_badge IN ('Quente', 'Morno', 'Frio')),
  status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'em_atendimento', 'simulacao', 'em_analise', 'digitacao', 'seguro_ap', 'assinatura', 'pagamento', 'ganho', 'perdido')),
  source TEXT NOT NULL,
  assigned_user_id INT REFERENCES users(id),
  created_by INT REFERENCES users(id),
  last_contact_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE loan_clients
ADD COLUMN IF NOT EXISTS heat_badge TEXT CHECK (heat_badge IN ('Quente', 'Morno', 'Frio'));

CREATE TABLE IF NOT EXISTS loan_client_phones (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES loan_clients(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  UNIQUE (client_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_loan_client_phones_phone ON loan_client_phones(phone);
CREATE INDEX IF NOT EXISTS idx_loan_clients_status ON loan_clients(status);
CREATE INDEX IF NOT EXISTS idx_loan_clients_deleted_at ON loan_clients(deleted_at);

CREATE TABLE IF NOT EXISTS transaction_terminals (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO transaction_terminals (code, name)
VALUES ('258', 'Terminal 258'), ('259', 'Terminal 259')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS transaction_daily (
  id SERIAL PRIMARY KEY,
  terminal_id INT REFERENCES transaction_terminals(id),
  day_date DATE NOT NULL,
  auth_count INT NOT NULL DEFAULT 0,
  saque_count INT NOT NULL DEFAULT 0,
  pix_saque_count INT NOT NULL DEFAULT 0,
  recarga_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by INT REFERENCES users(id),
  updated_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transaction_daily
ADD COLUMN IF NOT EXISTS terminal_id INT REFERENCES transaction_terminals(id);

ALTER TABLE transaction_daily DROP CONSTRAINT IF EXISTS transaction_daily_day_date_key;

UPDATE transaction_daily
SET terminal_id = (
  SELECT id
  FROM transaction_terminals
  ORDER BY id ASC
  LIMIT 1
)
WHERE terminal_id IS NULL;

ALTER TABLE transaction_daily
ALTER COLUMN terminal_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transaction_daily_day_date ON transaction_daily(day_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_daily_terminal_day ON transaction_daily(terminal_id, day_date);

CREATE TABLE IF NOT EXISTS financial_entries (
  id SERIAL PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('receita', 'despesa')),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  entry_date DATE NOT NULL,
  due_date DATE,
  reference_month DATE,
  paid_at TIMESTAMPTZ,
  paid_amount NUMERIC(14,2),
  template_id INT,
  notes TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES users(id),
  updated_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_entries_date ON financial_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_entries_type ON financial_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_financial_entries_due_date ON financial_entries(due_date);
CREATE INDEX IF NOT EXISTS idx_financial_entries_reference_month ON financial_entries(reference_month);

CREATE TABLE IF NOT EXISTS financial_expense_templates (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  default_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (default_amount >= 0),
  due_day INT NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  is_variable BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES users(id),
  updated_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE financial_entries
ADD COLUMN IF NOT EXISTS due_date DATE;

ALTER TABLE financial_entries
ADD COLUMN IF NOT EXISTS reference_month DATE;

ALTER TABLE financial_entries
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE financial_entries
ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2);

ALTER TABLE financial_entries
ADD COLUMN IF NOT EXISTS template_id INT;

ALTER TABLE financial_entries
DROP CONSTRAINT IF EXISTS financial_entries_template_fk;

ALTER TABLE financial_entries
ADD CONSTRAINT financial_entries_template_fk
FOREIGN KEY (template_id) REFERENCES financial_expense_templates(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_entries_template_month
ON financial_entries(template_id, reference_month)
WHERE template_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS documents_certificate_config (
  id SERIAL PRIMARY KEY,
  cnpj TEXT NOT NULL UNIQUE,
  runner_mode TEXT NOT NULL DEFAULT 'backend' CHECK (runner_mode IN ('backend', 'agent')),
  certificate_name TEXT,
  certificate_content_base64 TEXT,
  certificate_password TEXT,
  certificate_expires_at DATE,
  certificate_updated_at TIMESTAMPTZ,
  created_by INT REFERENCES users(id),
  updated_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents_certidoes (
  id SERIAL PRIMARY KEY,
  cnpj TEXT NOT NULL,
  cert_type TEXT NOT NULL CHECK (cert_type IN ('CNDT', 'CNF', 'CRF')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('valida', 'vencendo', 'vencida', 'pendente', 'falha')),
  issue_date DATE,
  expiry_date DATE,
  control_code TEXT,
  source_url TEXT,
  storage_path TEXT,
  file_hash TEXT,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cnpj, cert_type)
);

CREATE TABLE IF NOT EXISTS documents_certidoes_runs (
  id SERIAL PRIMARY KEY,
  cnpj TEXT NOT NULL,
  cert_type TEXT NOT NULL CHECK (cert_type IN ('CNDT', 'CNF', 'CRF')),
  runner_mode TEXT NOT NULL CHECK (runner_mode IN ('backend', 'agent')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  created_by INT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_documents_certidoes_status ON documents_certidoes(status);
CREATE INDEX IF NOT EXISTS idx_documents_certidoes_expiry ON documents_certidoes(expiry_date);
CREATE INDEX IF NOT EXISTS idx_documents_certidoes_checked ON documents_certidoes(last_checked_at);

CREATE TABLE IF NOT EXISTS loan_interactions (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES loan_clients(id),
  user_id INT REFERENCES users(id),
  channel TEXT NOT NULL DEFAULT 'manual',
  notes TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE loan_interactions
ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

ALTER TABLE loan_interactions
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_loan_interactions_scheduled_for ON loan_interactions(scheduled_for);

CREATE TABLE IF NOT EXISTS loan_products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('credito', 'seguros', 'capitalizacao', 'imobiliario')),
  default_rate NUMERIC(10,4) NOT NULL DEFAULT 0,
  min_term INT NOT NULL DEFAULT 1,
  max_term INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_simulations (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES loan_clients(id),
  product_id INT REFERENCES loan_products(id),
  product_type TEXT NOT NULL CHECK (product_type IN ('credito', 'seguros', 'capitalizacao', 'imobiliario')),
  principal NUMERIC(14,2) NOT NULL,
  installments INT NOT NULL,
  monthly_rate NUMERIC(10,4) NOT NULL,
  installment_value NUMERIC(14,2) NOT NULL,
  total_paid NUMERIC(14,2) NOT NULL,
  effective_cost NUMERIC(14,2) NOT NULL,
  is_best BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_imports (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  imported_by INT REFERENCES users(id),
  total_rows INT NOT NULL DEFAULT 0,
  imported_rows INT NOT NULL DEFAULT 0,
  duplicate_rows INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_public_servants (
  id SERIAL PRIMARY KEY,
  source_external_id TEXT,
  name TEXT NOT NULL,
  cargo TEXT NOT NULL DEFAULT '',
  unidade_gestora TEXT NOT NULL DEFAULT '',
  lotacao TEXT NOT NULL DEFAULT '',
  mes INT NOT NULL,
  ano INT NOT NULL,
  valor_liquido NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_bruto NUMERIC(14,2) NOT NULL DEFAULT 0,
  data_admissao TEXT NOT NULL DEFAULT '',
  regime TEXT NOT NULL DEFAULT '',
  vinculo TEXT NOT NULL DEFAULT '',
  classificacao_consignado TEXT NOT NULL CHECK (classificacao_consignado IN ('Com consignado', 'Sem consignado')),
  score_oportunidade INT NOT NULL DEFAULT 0,
  margem_maxima NUMERIC(14,2) NOT NULL DEFAULT 0,
  margem_utilizada NUMERIC(14,2) NOT NULL DEFAULT 0,
  margem_disponivel NUMERIC(14,2) NOT NULL DEFAULT 0,
  classificacao_margem TEXT NOT NULL DEFAULT 'Baixa' CHECK (classificacao_margem IN ('Alta', 'Media', 'Baixa')),
  score INT NOT NULL DEFAULT 0,
  classificacao_score TEXT NOT NULL DEFAULT 'Frio' CHECK (classificacao_score IN ('Quente', 'Morno', 'Frio')),
  valor_maximo_liberado NUMERIC(14,2) NOT NULL DEFAULT 0,
  melhor_parcela NUMERIC(14,2) NOT NULL DEFAULT 0,
  melhor_prazo INT NOT NULL DEFAULT 0,
  total_pago NUMERIC(14,2) NOT NULL DEFAULT 0,
  produto_recomendado TEXT NOT NULL DEFAULT '',
  motivo_recomendacao TEXT NOT NULL DEFAULT '',
  prioridade_atendimento TEXT NOT NULL DEFAULT 'Media' CHECK (prioridade_atendimento IN ('Alta', 'Media', 'Baixa')),
  raw_list_payload JSONB,
  raw_detail_payload JSONB,
  imported_by INT REFERENCES users(id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, unidade_gestora, mes, ano)
);

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS margem_maxima NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS margem_utilizada NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS margem_disponivel NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS classificacao_margem TEXT NOT NULL DEFAULT 'Baixa';

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS score INT NOT NULL DEFAULT 0;

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS classificacao_score TEXT NOT NULL DEFAULT 'Frio';

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS valor_maximo_liberado NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS melhor_parcela NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS melhor_prazo INT NOT NULL DEFAULT 0;

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS total_pago NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS produto_recomendado TEXT NOT NULL DEFAULT '';

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS motivo_recomendacao TEXT NOT NULL DEFAULT '';

ALTER TABLE loan_public_servants
ADD COLUMN IF NOT EXISTS prioridade_atendimento TEXT NOT NULL DEFAULT 'Media';

CREATE TABLE IF NOT EXISTS loan_settings (
  key TEXT PRIMARY KEY,
  value_text TEXT NOT NULL,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO loan_settings (key, value_text)
VALUES ('consignable_margin_percent', '30')
ON CONFLICT (key) DO NOTHING;

INSERT INTO loan_settings (key, value_text)
VALUES ('consignado_rate', '1.8'), ('pessoal_rate', '3.5')
ON CONFLICT (key) DO NOTHING;
`;
