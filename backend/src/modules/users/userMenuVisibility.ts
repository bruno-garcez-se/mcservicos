import { pool } from "../../db/pool";

let ensureColumnsPromise: Promise<void> | null = null;

export type NegocialSectionsVisibility = {
  cadastro: boolean;
  funil: boolean;
  agenda: boolean;
  importacoes: boolean;
  comissao: boolean;
  relatorios: boolean;
};

export type MenuVisibility = {
  senhas: boolean;
  transacional: boolean;
  negocial: boolean;
  contatos: boolean;
  negocialSections: NegocialSectionsVisibility;
};

export const DEFAULT_NEGOCIAL_SECTIONS_VISIBILITY: NegocialSectionsVisibility = {
  cadastro: true,
  funil: true,
  agenda: true,
  importacoes: true,
  comissao: true,
  relatorios: true,
};

export const DEFAULT_MENU_VISIBILITY: MenuVisibility = {
  senhas: true,
  transacional: true,
  negocial: true,
  contatos: true,
  negocialSections: DEFAULT_NEGOCIAL_SECTIONS_VISIBILITY,
};

export function normalizeNegocialSectionsVisibility(raw: unknown): NegocialSectionsVisibility {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_NEGOCIAL_SECTIONS_VISIBILITY };
  }
  const source = raw as Record<string, unknown>;
  return {
    cadastro: source.cadastro === undefined ? true : Boolean(source.cadastro),
    funil: source.funil === undefined ? true : Boolean(source.funil),
    agenda: source.agenda === undefined ? true : Boolean(source.agenda),
    importacoes: source.importacoes === undefined ? true : Boolean(source.importacoes),
    comissao: source.comissao === undefined ? true : Boolean(source.comissao),
    relatorios: source.relatorios === undefined ? true : Boolean(source.relatorios),
  };
}

export function normalizeMenuVisibility(raw: {
  senhas?: unknown;
  transacional?: unknown;
  negocial?: unknown;
  contatos?: unknown;
  negocialSections?: unknown;
}): MenuVisibility {
  return {
    senhas: raw.senhas === undefined ? true : Boolean(raw.senhas),
    transacional: raw.transacional === undefined ? true : Boolean(raw.transacional),
    negocial: raw.negocial === undefined ? true : Boolean(raw.negocial),
    contatos: raw.contatos === undefined ? true : Boolean(raw.contatos),
    negocialSections: normalizeNegocialSectionsVisibility(raw.negocialSections),
  };
}

export async function ensureUserMenuVisibilityColumns(): Promise<void> {
  if (!ensureColumnsPromise) {
    ensureColumnsPromise = (async () => {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_senhas BOOLEAN NOT NULL DEFAULT TRUE`);
      await pool.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_transacional BOOLEAN NOT NULL DEFAULT TRUE`,
      );
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_negocial BOOLEAN NOT NULL DEFAULT TRUE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_contatos BOOLEAN NOT NULL DEFAULT TRUE`);
      await pool.query(
        `ALTER TABLE users
         ADD COLUMN IF NOT EXISTS can_view_negocial_sections JSONB NOT NULL DEFAULT '{"cadastro":true,"funil":true,"agenda":true,"importacoes":true,"comissao":true,"relatorios":true}'::jsonb`,
      );
      await pool.query(
        `ALTER TABLE users
         ALTER COLUMN can_view_negocial_sections
         SET DEFAULT '{"cadastro":true,"funil":true,"agenda":true,"importacoes":true,"comissao":true,"relatorios":true}'::jsonb`,
      );
      await pool.query(
        `UPDATE users
         SET can_view_negocial_sections = COALESCE(can_view_negocial_sections, '{}'::jsonb) || '{"relatorios":true}'::jsonb
         WHERE can_view_negocial_sections IS NULL
            OR NOT (can_view_negocial_sections ? 'relatorios')`,
      );
    })();
  }

  try {
    await ensureColumnsPromise;
  } catch (error) {
    ensureColumnsPromise = null;
    throw error;
  }
}
