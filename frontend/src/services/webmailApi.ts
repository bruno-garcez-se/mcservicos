import { http } from "./http";

export type WebmailConfig = {
  url: string;
  smtpHost: string;
  smtpPort: string;
  imapHost: string;
  imapPort: string;
  login: string;
  password: string;
  updatedAt?: string | null;
};

type WebmailConfigApiResponse = {
  roundcubeUrl: string;
  smtpHost: string;
  smtpPort: string;
  imapHost: string;
  imapPort: string;
  login: string;
  password: string;
  updatedAt: string | null;
};

function fromApi(data: WebmailConfigApiResponse): WebmailConfig {
  return {
    url: data.roundcubeUrl,
    smtpHost: data.smtpHost,
    smtpPort: data.smtpPort,
    imapHost: data.imapHost,
    imapPort: data.imapPort,
    login: data.login,
    password: data.password,
    updatedAt: data.updatedAt,
  };
}

export async function getWebmailConfig(): Promise<WebmailConfig> {
  const { data } = await http.get<WebmailConfigApiResponse>("/webmail/config");
  return fromApi(data);
}

export async function saveWebmailConfig(payload: WebmailConfig): Promise<WebmailConfig> {
  const { data } = await http.put<WebmailConfigApiResponse>("/webmail/config", {
    roundcubeUrl: payload.url.trim(),
    smtpHost: payload.smtpHost.trim(),
    smtpPort: payload.smtpPort.trim(),
    imapHost: payload.imapHost.trim(),
    imapPort: payload.imapPort.trim(),
    login: payload.login.trim(),
    password: payload.password,
  });
  return fromApi(data);
}

export async function sendWebmailTestEmail(
  payload: Pick<WebmailConfig, "smtpHost" | "smtpPort" | "login" | "password"> & { to?: string },
): Promise<{ ok: boolean; message: string }> {
  const { data } = await http.post<{ ok: boolean; message: string }>("/webmail/config/test", {
    to: payload.to?.trim() || undefined,
    smtpHost: payload.smtpHost?.trim() || undefined,
    smtpPort: payload.smtpPort?.trim() || undefined,
    login: payload.login?.trim() || undefined,
    password: payload.password ?? undefined,
  });
  return data;
}
import { http } from "./http";

export type WebmailConfig = {
  url: string;
  smtpHost: string;
  smtpPort: string;
  imapHost: string;
  imapPort: string;
  login: string;
  password: string;
  updatedAt?: string | null;
};

type WebmailConfigApiResponse = {
  roundcubeUrl: string;
  smtpHost: string;
  smtpPort: string;
  imapHost: string;
  imapPort: string;
  login: string;
  password: string;
  updatedAt: string | null;
};

function fromApi(data: WebmailConfigApiResponse): WebmailConfig {
  return {
    url: data.roundcubeUrl,
    smtpHost: data.smtpHost,
    smtpPort: data.smtpPort,
    imapHost: data.imapHost,
    imapPort: data.imapPort,
    login: data.login,
    password: data.password,
    updatedAt: data.updatedAt,
  };
}

export async function getWebmailConfig(): Promise<WebmailConfig> {
  const { data } = await http.get<WebmailConfigApiResponse>("/webmail/config");
  return fromApi(data);
}

export async function saveWebmailConfig(payload: WebmailConfig): Promise<WebmailConfig> {
  const { data } = await http.put<WebmailConfigApiResponse>("/webmail/config", {
    roundcubeUrl: payload.url.trim(),
    smtpHost: payload.smtpHost.trim(),
    smtpPort: payload.smtpPort.trim(),
    imapHost: payload.imapHost.trim(),
    imapPort: payload.imapPort.trim(),
    login: payload.login.trim(),
    password: payload.password,
  });
  return fromApi(data);
}

export async function sendWebmailTestEmail(
  payload: Pick<WebmailConfig, "smtpHost" | "smtpPort" | "login" | "password"> & { to?: string },
): Promise<{ ok: boolean; message: string }> {
  const { data } = await http.post<{ ok: boolean; message: string }>("/webmail/config/test", {
    to: payload.to?.trim() || undefined,
    smtpHost: payload.smtpHost?.trim() || undefined,
    smtpPort: payload.smtpPort?.trim() || undefined,
    login: payload.login?.trim() || undefined,
    password: payload.password ?? undefined,
  });
  return data;
}
