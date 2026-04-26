import type { NextRequest } from "next/server";

export type RequestLocale = "tr" | "en";

export function getRequestLocale(request: NextRequest): RequestLocale {
  const explicit = request.headers.get("x-kinetic-locale")?.toLowerCase();
  if (explicit === "tr" || explicit === "en") return explicit;

  const accept = request.headers.get("accept-language")?.toLowerCase() ?? "";
  if (accept.startsWith("tr") || accept.includes(",tr")) return "tr";
  return "en";
}
