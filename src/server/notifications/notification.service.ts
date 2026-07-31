import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { addSystemLog } from "@/src/server/repositories/log.repository";

export type NotificationEventType =
  | "BUY"
  | "SELL"
  | "STOP_TRIGGERED"
  | "TARGET_RAISED"
  | "AI_RISK"
  | "DAILY_LOSS_WARNING"
  | "BINANCE_API_ERROR"
  | "EMERGENCY_STOP";

export type NotificationLevel = "INFO" | "WARN" | "ERROR";

type NotificationInput = {
  userId?: string;
  eventType: NotificationEventType;
  title: string;
  message: string;
  level?: NotificationLevel;
  symbol?: string;
  cooldownMinutes?: number;
};

const COOLDOWN_PREFIX = "notification.cooldown";

async function shouldSendWithCooldown(userId: string | undefined, eventType: NotificationEventType, cooldownMinutes?: number) {
  if (!userId || !cooldownMinutes || cooldownMinutes <= 0) return true;
  const key = `${COOLDOWN_PREFIX}.${userId}.${eventType}`;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = (row?.value as Record<string, unknown> | undefined) ?? {};
  const lastSentAt = typeof value.lastSentAt === "string" ? new Date(value.lastSentAt).getTime() : 0;
  if (lastSentAt && Date.now() - lastSentAt < cooldownMinutes * 60 * 1000) return false;
  await prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: "USER",
      userId,
      valueType: "json",
      status: "ACTIVE",
      description: "Notification cooldown state",
      value: { lastSentAt: new Date().toISOString() },
    },
    update: {
      value: { lastSentAt: new Date().toISOString() },
      status: "ACTIVE",
    },
  });
  return true;
}

async function sendTelegram(text: string) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  }).catch(() => null);
}

async function sendEmailWebhook(payload: { subject: string; message: string }) {
  if (!env.EMAIL_WEBHOOK_URL) return;
  await fetch(env.EMAIL_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);
}

export async function notifySystemEvent(input: NotificationInput) {
  const level = input.level ?? "INFO";
  const canSend = await shouldSendWithCooldown(input.userId, input.eventType, input.cooldownMinutes);
  if (!canSend) return;

  await addSystemLog({
    level: level === "ERROR" ? "ERROR" : level === "WARN" ? "WARN" : "INFO",
    source: input.eventType,
    message: `${input.title} | ${input.message}`,
    context: {
      actionType: "notification",
      eventType: input.eventType,
      symbol: input.symbol,
      level,
    },
  }).catch(() => null);

  const text = `${input.title}\n${input.message}${input.symbol ? `\nSymbol: ${input.symbol}` : ""}`;
  await Promise.all([
    sendTelegram(text),
    sendEmailWebhook({ subject: input.title, message: text }),
  ]).catch(() => null);
}
