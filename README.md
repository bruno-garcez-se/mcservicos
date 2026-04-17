# Portal de Senhas em Tempo Real

Sistema interno com aba `Senhas`, controle por grupos/departamentos e atualizacao instantanea via WebSocket.

## Requisitos

- Node.js 20+
- PostgreSQL 14+

## Configuracao

1. Copie os exemplos de ambiente:
   - `backend/.env.example` para `backend/.env`
   - `frontend/.env.example` para `frontend/.env`
2. Configure `DATABASE_URL` para seu banco PostgreSQL.
3. Crie o schema:
   - `npm run db:init -w backend`
4. Popule dados iniciais:
   - `npm run db:seed -w backend`
5. Rode tudo:
   - `npm run dev`

## Credenciais iniciais (seed)

- Admin: `admin@empresa.com` / `Admin@123`
- Funcionario: `financeiro@empresa.com` / `Func@123`

## Fluxo de tempo real

Quando um admin cria/edita/exclui uma senha, o backend emite eventos para os grupos vinculados e os clientes com a aba aberta recebem a atualizacao sem recarregar a pagina.
