import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { authRouter } from "./modules/auth/auth.routes";
import { contactsRouter } from "./modules/contacts/contacts.routes";
import { certidoesRouter } from "./modules/certidoes/certidoes.routes";
import { financeRouter } from "./modules/finance/finance.routes";
import { groupsRouter } from "./modules/groups/groups.routes";
import { loansRouter } from "./modules/loans/loans.routes";
import { passwordsRouter } from "./modules/passwords/passwords.routes";
import { transparenciaRouter } from "./modules/transparencia/transparencia.routes";
import { transactionsRouter } from "./modules/transactions/transactionsV2.routes";
import { usersRouter } from "./modules/users/users.routes";
import { vpnRouter } from "./modules/vpn/vpn.routes";
import { errorHandler } from "./middlewares/errorHandler";

export const app = express();

const defaultAllowedOrigins = ["https://frontend-mc-servicos.vercel.app"];

const allowedOrigins = new Set(
  [
    ...defaultAllowedOrigins,
    env.FRONTEND_URL,
    ...(env.FRONTEND_URLS
      ? env.FRONTEND_URLS.split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      : []),
  ].map((origin) => origin.toLowerCase()),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite chamadas servidor-servidor e health checks sem Origin.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin.toLowerCase())) {
        callback(null, true);
        return;
      }

      callback(new Error("Origem nao permitida pelo CORS."));
    },
    credentials: true,
  }),
);
app.use(helmet());
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "portal-senhas-api" });
});

app.use("/auth", authRouter);
app.use("/groups", groupsRouter);
app.use("/loans", loansRouter);
app.use("/transactions", transactionsRouter);
app.use("/api", transparenciaRouter);
app.use("/passwords", passwordsRouter);
app.use("/contacts", contactsRouter);
app.use("/documents/certidoes", certidoesRouter);
app.use("/financial", financeRouter);
app.use("/users", usersRouter);
app.use("/vpn", vpnRouter);
app.use(errorHandler);
