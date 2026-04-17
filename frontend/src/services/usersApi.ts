import { ManagedUser } from "../types";
import { http } from "./http";

export async function listUsers(): Promise<ManagedUser[]> {
  const { data } = await http.get<ManagedUser[]>("/users");
  return data;
}

export async function createUser(payload: {
  name: string;
  email: string;
  password: string;
  role: "admin" | "employee";
  active: boolean;
  groupIds: number[];
}): Promise<ManagedUser> {
  const { data } = await http.post<ManagedUser>("/users", payload);
  return data;
}

export async function updateUser(
  id: number,
  payload: {
    name: string;
    email: string;
    password?: string;
    role: "admin" | "employee";
    active: boolean;
    groupIds: number[];
  },
): Promise<ManagedUser> {
  const { data } = await http.put<ManagedUser>(`/users/${id}`, payload);
  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await http.delete(`/users/${id}`);
}
