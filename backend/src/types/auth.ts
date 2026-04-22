export type UserRole = "admin" | "employee" | "observer";

export type AuthUser = {
  id: number;
  role: UserRole;
  groupIds: number[];
  menuVisibility: {
    senhas: boolean;
    transacional: boolean;
    negocial: boolean;
    contatos: boolean;
    negocialSections: {
      cadastro: boolean;
      funil: boolean;
      agenda: boolean;
      importacoes: boolean;
      comissao: boolean;
      relatorios: boolean;
    };
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
    contatos: boolean;
    negocialSections: {
      cadastro: boolean;
      funil: boolean;
      agenda: boolean;
      importacoes: boolean;
      comissao: boolean;
      relatorios: boolean;
    };
  };
};
