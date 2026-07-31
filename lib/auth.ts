import { NextRequest } from "next/server";
import { env, isProd } from "@/lib/config";

function safeTokenEquals(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export function checkApiToken(request: NextRequest) {
  const strictTokenRequired = isProd || env.EXECUTION_MODE === "live" || process.env.TRADING_CORE_LIVE_EXECUTION === "true";
  const internal = request.headers.get("x-kinetic-internal") === "1";
  const fetchSite = request.headers.get("sec-fetch-site");
  const sameOriginInternal = internal && (!fetchSite || fetchSite === "same-origin");
  if (!isProd && sameOriginInternal) {
    return true;
  }

  if (!env.APP_TOKEN && !env.APP_TOKEN_NEXT) {
    return !strictTokenRequired;
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const token = request.headers.get("x-kinetic-token") ?? bearer ?? "";
  const candidates = [env.APP_TOKEN, env.APP_TOKEN_NEXT].filter((row): row is string => Boolean(row));
  return candidates.some((candidate) => safeTokenEquals(token, candidate));
}
