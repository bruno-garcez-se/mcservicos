import { io, Socket } from "socket.io-client";

let socketRef: Socket | null = null;

export function connectRealtime(token: string): Socket {
  if (socketRef) {
    socketRef.disconnect();
    socketRef = null;
  }

  socketRef = io(import.meta.env.VITE_API_URL ?? "http://localhost:3333", {
    auth: { token },
    transports: ["websocket"],
  });

  return socketRef;
}

export function disconnectRealtime(): void {
  if (socketRef) {
    socketRef.disconnect();
    socketRef = null;
  }
}
