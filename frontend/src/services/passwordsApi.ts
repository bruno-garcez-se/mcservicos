import { Credential, ExtraField, Group } from "../types";
import { http } from "./http";

export async function listCredentials(): Promise<Credential[]> {
  const { data } = await http.get<Credential[]>("/passwords");
  return data;
}

export async function createCredential(payload: {
  systemName: string;
  accessMode: "web" | "vpn";
  linkUrl: string;
  username: string;
  password: string;
  groupIds: number[];
  extraFields: ExtraField[];
}): Promise<Credential> {
  const { data } = await http.post<Credential>("/passwords", payload);
  return data;
}

export async function updateCredential(
  id: number,
  payload: {
    systemName: string;
    accessMode: "web" | "vpn";
    linkUrl: string;
    username: string;
    password: string;
    groupIds: number[];
    extraFields: ExtraField[];
  },
): Promise<Credential> {
  const { data } = await http.put<Credential>(`/passwords/${id}`, payload);
  return data;
}

export async function deleteCredential(id: number): Promise<void> {
  await http.delete(`/passwords/${id}`);
}

export async function listGroups(): Promise<Group[]> {
  const { data } = await http.get<Group[]>("/groups");
  return data;
}
