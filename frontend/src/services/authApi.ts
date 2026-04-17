import { http } from "./http";
import { User } from "../types";

type LoginResponse = {
  accessToken: string;
  user: User;
};

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await http.post<LoginResponse>("/auth/login", { email, password });
  return data;
}

export async function refreshToken(): Promise<string> {
  const { data } = await http.post<{ accessToken: string }>("/auth/refresh");
  return data.accessToken;
}

export async function getMe(): Promise<User> {
  const { data } = await http.get<User>("/auth/me");
  return data;
}

export async function logout(): Promise<void> {
  await http.post("/auth/logout");
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await http.post("/auth/change-password", { currentPassword, newPassword });
}
