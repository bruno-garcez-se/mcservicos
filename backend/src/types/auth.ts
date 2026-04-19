export type UserRole = "admin" | "employee";

export type AuthUser = {
  id: number;
  role: UserRole;
  groupIds: number[];
  menuVisibility: {
    senhas: boolean;
    transacional: boolean;
    negocial: boolean;
  };
};

export type JwtPayload = {
  sub: number;
  role: UserRole;
  groupIds: number[];
  menuVisibility: {
    senhas: boolean;
    transacional: boolean;
    negocial: boolean;
  };
};
