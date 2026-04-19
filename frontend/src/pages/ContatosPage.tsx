import { FormEvent, useEffect, useMemo, useState } from "react";
import { Contact } from "../types";
import { createContact, deleteContact, listContacts, updateContact } from "../services/contactsApi";

type ContactPhoneForm = {
  phone: string;
  hasWhatsapp: boolean;
};

type ContactForm = {
  id?: number;
  name: string;
  company: string;
  sector: string;
  cargo: string;
  notes: string;
  phones: ContactPhoneForm[];
};

const emptyForm: ContactForm = {
  name: "",
  company: "",
  sector: "",
  cargo: "",
  notes: "",
  phones: [{ phone: "", hasWhatsapp: false }],
};

function toWhatsappLink(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.startsWith("55")) return `https://wa.me/${digits}`;
  return `https://wa.me/55${digits}`;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M12 2a10 10 0 0 0-8.73 14.88L2 22l5.27-1.24A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4.06-1.1l-.29-.17-3.13.74.74-3.04-.19-.31A8 8 0 1 1 12 20Zm4.52-5.95c-.25-.13-1.46-.72-1.69-.8-.23-.09-.39-.13-.56.13-.17.25-.64.8-.79.97-.15.17-.29.2-.54.07-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.38-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.07-.13-.56-1.36-.77-1.86-.2-.48-.4-.41-.56-.42h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.76 2.68 4.26 3.76.59.25 1.06.4 1.42.51.6.19 1.14.16 1.57.1.48-.07 1.46-.6 1.67-1.17.21-.57.21-1.06.15-1.17-.06-.1-.23-.17-.48-.29Z"
        fill="currentColor"
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

function ContactsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.2 3a2.2 2.2 0 0 0-2.1 2.7c1.2 5.3 5.9 10 11.2 11.2a2.2 2.2 0 0 0 2.7-2.1v-2a1.2 1.2 0 0 0-1-1.2l-2.7-.6a1.2 1.2 0 0 0-1.2.5l-.8 1.1a8.9 8.9 0 0 1-3.8-3.8l1.1-.8a1.2 1.2 0 0 0 .5-1.2L10.4 4a1.2 1.2 0 0 0-1.2-1h-2Z"
      />
    </svg>
  );
}

export function ContatosPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({
    name: "",
    company: "",
    sector: "",
    cargo: "",
  });

  const feedbackLabel = (text: string): string => {
    const normalized = text.toLowerCase();
    if (normalized.includes("falha") || normalized.includes("erro")) return "Erro";
    if (normalized.includes("salvo") || normalized.includes("cadastrado") || normalized.includes("atualizado")) {
      return "Sucesso";
    }
    return "Aviso";
  };

  const sortedContacts = useMemo(
    () => [...contacts].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [contacts],
  );
  const filteredContacts = useMemo(() => {
    const nameFilter = filters.name.trim().toLowerCase();
    const companyFilter = filters.company.trim().toLowerCase();
    const sectorFilter = filters.sector.trim().toLowerCase();
    const cargoFilter = filters.cargo.trim().toLowerCase();
    return sortedContacts.filter((contact) => {
      const matchesName = !nameFilter || contact.name.toLowerCase().includes(nameFilter);
      const matchesCompany = !companyFilter || contact.company.toLowerCase().includes(companyFilter);
      const matchesSector = !sectorFilter || contact.sector.toLowerCase().includes(sectorFilter);
      const matchesCargo = !cargoFilter || contact.cargo.toLowerCase().includes(cargoFilter);
      return matchesName && matchesCompany && matchesSector && matchesCargo;
    });
  }, [sortedContacts, filters]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await listContacts();
      setContacts(data);
    } catch {
      setMessage("Falha ao carregar contatos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const onAdd = () => {
    setForm(emptyForm);
    setIsModalOpen(true);
    setMessage("");
  };

  const onEdit = (contact: Contact) => {
    setForm({
      id: contact.id,
      name: contact.name,
      company: contact.company,
      sector: contact.sector,
      cargo: contact.cargo,
      notes: contact.notes,
      phones:
        contact.phones.length > 0
          ? contact.phones.map((item) => ({ phone: item.phone, hasWhatsapp: item.hasWhatsapp }))
          : [{ phone: "", hasWhatsapp: false }],
    });
    setIsModalOpen(true);
    setMessage("");
  };

  const onDelete = async (contact: Contact) => {
    if (!window.confirm(`Deseja excluir o contato "${contact.name}"?`)) return;
    try {
      await deleteContact(contact.id);
      setContacts((prev) => prev.filter((item) => item.id !== contact.id));
      setMessage("Contato excluído.");
    } catch {
      setMessage("Falha ao excluir contato.");
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const payload = {
      name: form.name,
      company: form.company,
      sector: form.sector,
      cargo: form.cargo,
      notes: form.notes,
      phones: form.phones.filter((item) => item.phone.trim()).map((item) => ({
        phone: item.phone.trim(),
        hasWhatsapp: item.hasWhatsapp,
      })),
    };

    try {
      if (form.id) {
        const updated = await updateContact(form.id, payload);
        setContacts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setMessage("Contato atualizado.");
      } else {
        const created = await createContact(payload);
        setContacts((prev) => [...prev, created]);
        setMessage("Contato cadastrado.");
      }
      setIsModalOpen(false);
      setForm(emptyForm);
    } catch {
      setMessage("Falha ao salvar contato.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-grid single-column">
      <section className="card">
        <div className="section-header-row">
          <h2 className="loan-title-icon-label">
            <ContactsIcon />
            <span>Contatos</span>
          </h2>
          <button type="button" className="transaction-top-action transaction-top-action-new" onClick={onAdd}>
            <span className="button-icon-inline">
              <PlusIcon />
              <span>Novo</span>
            </span>
          </button>
        </div>
        <div className="contact-filters">
          <label>
            Nome
            <input
              placeholder="Buscar por nome"
              value={filters.name}
              onChange={(event) => setFilters((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>
          <label>
            Empresa
            <input
              placeholder="Buscar por empresa"
              value={filters.company}
              onChange={(event) => setFilters((prev) => ({ ...prev, company: event.target.value }))}
            />
          </label>
          <label>
            Setor
            <input
              placeholder="Buscar por setor"
              value={filters.sector}
              onChange={(event) => setFilters((prev) => ({ ...prev, sector: event.target.value }))}
            />
          </label>
          <label>
            Cargo
            <input
              placeholder="Buscar por cargo"
              value={filters.cargo}
              onChange={(event) => setFilters((prev) => ({ ...prev, cargo: event.target.value }))}
            />
          </label>
        </div>

        <div className="transaction-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Empresa</th>
                <th>Setor</th>
                <th>Cargo</th>
                <th>Telefones</th>
                <th>Observações</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>Carregando contatos...</td>
                </tr>
              ) : filteredContacts.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nenhum contato encontrado com os filtros atuais.</td>
                </tr>
              ) : (
                filteredContacts.map((contact) => (
                  <tr key={contact.id}>
                    <td>{contact.name}</td>
                    <td>{contact.company || "-"}</td>
                    <td>{contact.sector || "-"}</td>
                    <td>{contact.cargo || "-"}</td>
                    <td>
                      <div className="contact-phones-list">
                        {contact.phones.length === 0 ? (
                          <span>-</span>
                        ) : (
                          contact.phones.map((phone) => {
                            const link = phone.hasWhatsapp ? toWhatsappLink(phone.phone) : null;
                            return (
                              <div key={`${contact.id}-${phone.id}`} className="contact-phone-item">
                                <span>{phone.phone}</span>
                                {link ? (
                                  <button
                                    type="button"
                                    className="contact-whatsapp-button"
                                    title="Abrir conversa no WhatsApp"
                                    onClick={() => window.open(link, "_blank", "noopener,noreferrer")}
                                  >
                                    <WhatsAppIcon />
                                  </button>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </td>
                    <td>{contact.notes || "-"}</td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="transaction-icon-button"
                          title="Editar contato"
                          aria-label="Editar contato"
                          onClick={() => onEdit(contact)}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="transaction-icon-button danger"
                          title="Excluir contato"
                          aria-label="Excluir contato"
                          onClick={() => void onDelete(contact)}
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
        </div>
      </section>

      {message ? <p className="copy-feedback">{`${feedbackLabel(message)}: ${message}`}</p> : null}

      {isModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-contatos" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>{form.id ? "Editar contato" : "Novo contato"}</h2>
              <button type="button" onClick={() => setIsModalOpen(false)}>
                X
              </button>
            </div>
            <form className="form-stack" onSubmit={onSubmit}>
              <label>
                Nome
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </label>
              <label>
                Empresa
                <input
                  value={form.company}
                  onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))}
                />
              </label>
              <label>
                Setor
                <input
                  value={form.sector}
                  onChange={(event) => setForm((prev) => ({ ...prev, sector: event.target.value }))}
                />
              </label>
              <label>
                Cargo
                <input
                  value={form.cargo}
                  onChange={(event) => setForm((prev) => ({ ...prev, cargo: event.target.value }))}
                />
              </label>
              <fieldset>
                <legend>Telefone</legend>
                <div className="contact-phone-form-list">
                  {form.phones.map((phone, index) => (
                    <div key={`phone-${index}`} className="contact-phone-form-row">
                      <input
                        placeholder="(79) 99999-9999"
                        value={phone.phone}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            phones: prev.phones.map((item, idx) =>
                              idx === index ? { ...item, phone: event.target.value } : item,
                            ),
                          }))
                        }
                      />
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={phone.hasWhatsapp}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              phones: prev.phones.map((item, idx) =>
                                idx === index ? { ...item, hasWhatsapp: event.target.checked } : item,
                              ),
                            }))
                          }
                        />
                        WhatsApp
                      </label>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            phones:
                              prev.phones.length > 1
                                ? prev.phones.filter((_, idx) => idx !== index)
                                : [{ phone: "", hasWhatsapp: false }],
                          }))
                        }
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      phones: [...prev.phones, { phone: "", hasWhatsapp: false }],
                    }))
                  }
                >
                  + Telefone
                </button>
              </fieldset>
              <label>
                Observações
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </label>
              <div className="row">
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar"}
                </button>
                <button type="button" onClick={() => setIsModalOpen(false)} disabled={saving}>
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
