import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { requireAuth } from "../../middlewares/auth";

const contactsRouter = Router();

const phoneSchema = z.object({
  phone: z.string().trim().min(1),
  hasWhatsapp: z.boolean().default(false),
});

const payloadSchema = z.object({
  name: z.string().trim().min(1),
  company: z.string().trim().default(""),
  sector: z.string().trim().default(""),
  cargo: z.string().trim().default(""),
  notes: z.string().trim().default(""),
  phones: z.array(phoneSchema).default([]),
});

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

async function ensureContactStructures(): Promise<void> {
  await pool.query(`
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
  `);
  await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS cargo TEXT NOT NULL DEFAULT '';`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_phones (
      id SERIAL PRIMARY KEY,
      contact_id INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      has_whatsapp BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_phones_contact_phone ON contact_phones(contact_id, phone);`,
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contact_phones_phone ON contact_phones(phone);`);
}

type ContactRow = {
  id: number;
  name: string;
  company: string;
  sector: string;
  cargo: string;
  notes: string;
  created_at: string;
  updated_at: string;
  phones: Array<{ id: number; phone: string; hasWhatsapp: boolean }> | null;
};

function normalizePhones(phones: Array<{ phone: string; hasWhatsapp: boolean }>) {
  const unique = new Map<string, { phone: string; hasWhatsapp: boolean }>();
  for (const item of phones) {
    const normalizedPhone = item.phone.trim();
    if (!normalizedPhone) continue;
    unique.set(normalizedPhone, { phone: normalizedPhone, hasWhatsapp: Boolean(item.hasWhatsapp) });
  }
  return Array.from(unique.values());
}

contactsRouter.use(requireAuth);

contactsRouter.get("/", async (_req, res) => {
  await ensureContactStructures();
  const result = await pool.query(
    `SELECT c.id,
            c.name,
            c.company,
            c.sector,
            c.cargo,
            c.notes,
            c.created_at,
            c.updated_at,
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'id', cp.id,
                  'phone', cp.phone,
                  'hasWhatsapp', cp.has_whatsapp
                )
                ORDER BY cp.id ASC
              ) FILTER (WHERE cp.id IS NOT NULL),
              '[]'::json
            ) AS phones
     FROM contacts c
     LEFT JOIN contact_phones cp ON cp.contact_id = c.id
     GROUP BY c.id
     ORDER BY c.name ASC`,
  );

  const contacts = result.rows.map((row) => {
    const data = row as ContactRow;
    return {
      id: Number(data.id),
      name: String(data.name),
      company: String(data.company ?? ""),
      sector: String(data.sector ?? ""),
      cargo: String(data.cargo ?? ""),
      notes: String(data.notes ?? ""),
      createdAt: String(data.created_at),
      updatedAt: String(data.updated_at),
      phones: Array.isArray(data.phones)
        ? data.phones.map((phone) => ({
            id: Number(phone.id),
            phone: String(phone.phone),
            hasWhatsapp: Boolean(phone.hasWhatsapp),
          }))
        : [],
    };
  });

  res.json(contacts);
});

contactsRouter.post("/", async (req, res) => {
  await ensureContactStructures();
  const user = req.user!;
  const payload = payloadSchema.parse(req.body);
  const phones = normalizePhones(payload.phones);

  const createdResult = await pool.query(
    `INSERT INTO contacts (name, company, sector, cargo, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING id, name, company, sector, cargo, notes, created_at, updated_at`,
    [payload.name, payload.company, payload.sector, payload.cargo, payload.notes, user.id],
  );

  const created = createdResult.rows[0] as ContactRow;

  if (phones.length > 0) {
    await pool.query(
      `INSERT INTO contact_phones (contact_id, phone, has_whatsapp)
       SELECT $1, p.phone, p.has_whatsapp
       FROM jsonb_to_recordset($2::jsonb) AS p(phone text, has_whatsapp boolean)`,
      [created.id, JSON.stringify(phones.map((phone) => ({ phone: phone.phone, has_whatsapp: phone.hasWhatsapp })))],
    );
  }

  const phonesResult = await pool.query(
    `SELECT id, phone, has_whatsapp
     FROM contact_phones
     WHERE contact_id = $1
     ORDER BY id ASC`,
    [created.id],
  );

  res.status(201).json({
    id: Number(created.id),
    name: String(created.name),
    company: String(created.company ?? ""),
    sector: String(created.sector ?? ""),
    cargo: String(created.cargo ?? ""),
    notes: String(created.notes ?? ""),
    createdAt: String(created.created_at),
    updatedAt: String(created.updated_at),
    phones: phonesResult.rows.map((row) => ({
      id: Number(row.id),
      phone: String(row.phone),
      hasWhatsapp: Boolean(row.has_whatsapp),
    })),
  });
});

contactsRouter.put("/:id", async (req, res) => {
  await ensureContactStructures();
  const user = req.user!;
  const params = paramsSchema.parse(req.params);
  const payload = payloadSchema.parse(req.body);
  const phones = normalizePhones(payload.phones);

  const updatedResult = await pool.query(
    `UPDATE contacts
     SET name = $1,
         company = $2,
         sector = $3,
         cargo = $4,
         notes = $5,
         updated_by = $6,
         updated_at = NOW()
     WHERE id = $7
     RETURNING id, name, company, sector, cargo, notes, created_at, updated_at`,
    [payload.name, payload.company, payload.sector, payload.cargo, payload.notes, user.id, params.id],
  );

  if (updatedResult.rowCount === 0) {
    res.status(404).json({ message: "Contato nao encontrado." });
    return;
  }

  await pool.query(`DELETE FROM contact_phones WHERE contact_id = $1`, [params.id]);
  if (phones.length > 0) {
    await pool.query(
      `INSERT INTO contact_phones (contact_id, phone, has_whatsapp)
       SELECT $1, p.phone, p.has_whatsapp
       FROM jsonb_to_recordset($2::jsonb) AS p(phone text, has_whatsapp boolean)`,
      [params.id, JSON.stringify(phones.map((phone) => ({ phone: phone.phone, has_whatsapp: phone.hasWhatsapp })))],
    );
  }

  const updated = updatedResult.rows[0] as ContactRow;
  const phonesResult = await pool.query(
    `SELECT id, phone, has_whatsapp
     FROM contact_phones
     WHERE contact_id = $1
     ORDER BY id ASC`,
    [params.id],
  );

  res.json({
    id: Number(updated.id),
    name: String(updated.name),
    company: String(updated.company ?? ""),
    sector: String(updated.sector ?? ""),
    cargo: String(updated.cargo ?? ""),
    notes: String(updated.notes ?? ""),
    createdAt: String(updated.created_at),
    updatedAt: String(updated.updated_at),
    phones: phonesResult.rows.map((row) => ({
      id: Number(row.id),
      phone: String(row.phone),
      hasWhatsapp: Boolean(row.has_whatsapp),
    })),
  });
});

contactsRouter.delete("/:id", async (req, res) => {
  await ensureContactStructures();
  const params = paramsSchema.parse(req.params);
  const deleted = await pool.query(`DELETE FROM contacts WHERE id = $1 RETURNING id`, [params.id]);
  if (deleted.rowCount === 0) {
    res.status(404).json({ message: "Contato nao encontrado." });
    return;
  }
  res.status(204).send();
});

export { contactsRouter };
