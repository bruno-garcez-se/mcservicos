import { http } from "./http";

export type VpnStatus = {
  supported: boolean;
  configured: boolean;
  connected: boolean;
  connectionName: string | null;
  message?: string;
};

export async function getVpnStatus(): Promise<VpnStatus> {
  const { data } = await http.get<VpnStatus>("/vpn/status");
  return data;
}

export async function setVpnEnabled(enabled: boolean): Promise<VpnStatus> {
  const { data } = await http.post<VpnStatus>("/vpn/toggle", { enabled });
  return data;
}
