export type Role = "admin" | "employee";

export type User = {
  id: number;
  name: string;
  email: string;
  role: Role;
  groupIds: number[];
};

export type ManagedUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  groupIds: number[];
};

export type Group = {
  id: number;
  name: string;
};

export type ExtraField = {
  name: string;
  value: string;
};

export type Credential = {
  id: number;
  systemName: string;
  linkUrl: string;
  username: string;
  password: string;
  updatedAt: string;
  groupIds: number[];
  extraFields: ExtraField[];
};
