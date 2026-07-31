import pino from "pino";
import { isProd } from "@/lib/config";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: "kinetic-app",
    env: process.env.NODE_ENV ?? "development",
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.x-kinetic-token",
      "req.headers.x-idempotency-key",
      "req.headers.idempotency-key",
      "req.headers.cookie",
      "headers.authorization",
      "headers.x-kinetic-token",
      "headers.cookie",
      "apiKey",
      "apiSecret",
      "secret",
      "*.apiSecretEncrypted",
      "*.passwordHash",
      "password",
      "token",
    ],
    remove: true,
  },
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      },
});
