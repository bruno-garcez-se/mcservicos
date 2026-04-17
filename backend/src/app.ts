import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { authRouter } from "./modules/auth/auth.routes";
import { groupsRouter } from "./modules/groups/groups.routes";
import { passwordsRouter } from "./modules/passwords/passwords.routes";
import { usersRouter } from "./modules/users/users.routes";
import { errorHandler } from "./middlewares/errorHandler";

export const app = express();

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);
app.use(helmet());
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "portal-senhas-api" });
});

app.use("/auth", authRouter);
app.use("/groups", groupsRouter);
app.use("/passwords", passwordsRouter);
app.use("/users", usersRouter);
app.use(errorHandler);
