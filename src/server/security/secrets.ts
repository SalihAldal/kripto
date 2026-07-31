import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import { env, isProd } from "@/lib/config";

const ALGORITHM = "aes-256-gcm";

function buildSecretKey() {
  if (!env.APP_ENCRYPTION_KEY) {
    if (isProd) {
      throw new Error("APP_ENCRYPTION_KEY is required in production");
    }
    return createHash("sha256").update("local-dev-fallback-key").digest();
  }
  return createHash("sha256").update(env.APP_ENCRYPTION_KEY).digest();
}

export function maskSecret(value?: string | null) {
  if (!value) return "not-configured";
  if (value.length < 8) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function encryptSecret(plainText: string) {
  const key = buildSecretKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export async function upsertExchangeApiSecret(userId: string, exchangeName: string, apiSecretRaw: string) {
  const encrypted = encryptSecret(apiSecretRaw);
  const key = `secrets.exchange.${exchangeName}.${userId}`;
  await prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: "USER",
      userId,
      value: {
        encrypted,
        rotationAt: new Date().toISOString(),
      },
      valueType: "json",
      isSecret: true,
      status: "ACTIVE",
      description: `${exchangeName} API secret (encrypted)`,
      metadata: {
        rotatedBy: "env-bootstrap",
      },
    },
    update: {
      value: {
        encrypted,
        rotationAt: new Date().toISOString(),
      },
      isSecret: true,
      status: "ACTIVE",
    },
  });
  return encrypted;
}
