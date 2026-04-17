import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { JwtPayload } from "../types/auth";
import { verifyAccessToken } from "../utils/jwt";

let ioRef: Server | null = null;

export function setupSocket(server: HttpServer): Server {
  const io = new Server(server, {
    cors: {
      origin: env.FRONTEND_URL,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        return next(new Error("Token ausente no socket."));
      }

      const payload = verifyAccessToken(token) as JwtPayload;
      socket.data.user = payload;
      return next();
    } catch {
      return next(new Error("Token invalido no socket."));
    }
  });

  io.on("connection", (socket) => {
    const payload = socket.data.user as JwtPayload;
    payload.groupIds.forEach((groupId) => {
      socket.join(`group:${groupId}`);
    });
    if (payload.role === "admin") {
      socket.join("role:admin");
    }
    socket.join(`user:${payload.sub}`);
  });

  ioRef = io;
  return io;
}

export function emitCredentialUpsert(
  groupIds: number[],
  credential: Record<string, unknown>,
): void {
  if (!ioRef) return;
  ioRef.to("role:admin").emit("password:upsert", credential);
  groupIds.forEach((groupId) => {
    ioRef?.to(`group:${groupId}`).emit("password:upsert", credential);
  });
}

export function emitCredentialDelete(groupIds: number[], credentialId: number): void {
  if (!ioRef) return;
  ioRef.to("role:admin").emit("password:delete", { id: credentialId });
  groupIds.forEach((groupId) => {
    ioRef?.to(`group:${groupId}`).emit("password:delete", { id: credentialId });
  });
}
