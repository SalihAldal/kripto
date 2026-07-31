import type { NextApiRequest } from "next";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { tradingDashboardSnapshotService } from "@/src/server/trading-core/dashboard/dashboard-snapshot.service";

type SocketServerWithIo = HttpServer & {
  io?: SocketIOServer;
};

type NextApiResponseWithSocket = {
  socket: {
    server: SocketServerWithIo;
  };
  end: () => void;
};

export default function handler(_req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (!res.socket.server.io) {
    const io = new SocketIOServer(res.socket.server, {
      path: "/api/socket/trading-dashboard",
      addTrailingSlash: false,
      cors: { origin: "*", methods: ["GET", "POST"] },
    });

    io.on("connection", (socket) => {
      socket.emit("dashboard:snapshot", tradingDashboardSnapshotService.snapshot());
    });

    setInterval(() => {
      io.emit("dashboard:snapshot", tradingDashboardSnapshotService.snapshot());
    }, 1500);

    res.socket.server.io = io;
  }

  res.end();
}
