import { NextRequest } from "next/server";
import { env } from "@/lib/config";

function safeTokenEquals(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export function checkApiToken(request: NextRequest) {
  const internal = request.headers.get("x-kinetic-internal") === "1";
  const fetchSite = request.headers.get("sec-fetch-site");
  if (internal && (!fetchSite || fetchSite === "same-origin")) {
    return true;
  }

  if (!env.APP_TOKEN && !env.APP_TOKEN_NEXT) {
    return true;
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const token = request.headers.get("x-kinetic-token") ?? bearer ?? "";
  const candidates = [env.APP_TOKEN, env.APP_TOKEN_NEXT].filter((row): row is string => Boolean(row));
  return candidates.some((candidate) => safeTokenEquals(token, candidate));
}
