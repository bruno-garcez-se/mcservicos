export type UserRole = "admin" | "employee";

export type AuthUser = {
  id: number;
  role: UserRole;
  groupIds: number[];
};

export type JwtPayload = {
  sub: number;
  role: UserRole;
  groupIds: number[];
};
