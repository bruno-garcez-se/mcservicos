import { Contact } from "../types";
import { http } from "./http";

type ContactPayload = {
  name: string;
  company: string;
  sector: string;
  cargo: string;
  notes: string;
  phones: Array<{ phone: string; hasWhatsapp: boolean }>;
};

export async function listContacts(): Promise<Contact[]> {
  const { data } = await http.get<Contact[]>("/contacts");
  return data;
}

export async function createContact(payload: ContactPayload): Promise<Contact> {
  const { data } = await http.post<Contact>("/contacts", payload);
  return data;
}

export async function updateContact(id: number, payload: ContactPayload): Promise<Contact> {
  const { data } = await http.put<Contact>(`/contacts/${id}`, payload);
  return data;
}

export async function deleteContact(id: number): Promise<void> {
  await http.delete(`/contacts/${id}`);
}
