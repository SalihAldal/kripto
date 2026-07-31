import { NextRequest } from "next/server";
import { apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";

function normalizeIp(value: string | null | undefined) {
  const ip = value?.trim();
  if (!ip || ip === "::1" || ip === "127.0.0.1" || ip.toLowerCase() === "localhost") return null;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) formatini sadeleştir.
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  const limited = enforceRateLimit(request);
  if (limited) return limited;

  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const forwarded = request.headers.get("forwarded");

  const forwardedFirst = forwardedFor?.split(",")[0]?.trim() ?? null;
  const headerIp = normalizeIp(forwardedFirst) ?? normalizeIp(realIp);

  let ipFromOutbound: string | null = null;
  let source: "header" | "outbound" | "unknown" = "unknown";
  let hint: string | null = null;

  if (headerIp) {
    ipFromOutbound = headerIp;
    source = "header";
  } else {
    const providers = ["https://api.ipify.org?format=json", "https://ifconfig.me/ip"] as const;
    for (const url of providers) {
      try {
        const res = await fetch(url, { method: "GET", cache: "no-store" });
        if (!res.ok) continue;
        if (url.includes("ipify")) {
          const json = (await res.json().catch(() => ({}))) as { ip?: string };
          const ip = normalizeIp(json.ip ?? null);
          if (ip) {
            ipFromOutbound = ip;
            source = "outbound";
            break;
          }
        } else {
          const text = await res.text().catch(() => "");
          const ip = normalizeIp(text);
          if (ip) {
            ipFromOutbound = ip;
            source = "outbound";
            break;
          }
        }
      } catch {
        // next provider
      }
    }
  }

  if (!ipFromOutbound) {
    hint = tr
      ? "Public IP tespit edilemedi. Reverse proxy veya local ag nedeniyle header bilgisi bos olabilir."
      : "Public IP could not be detected. Header values may be empty due to reverse proxy or local network.";
  }

  if (source === "header" && forwardedFor && forwardedFor.includes(",")) {
    hint = tr
      ? "x-forwarded-for birden fazla IP iceriyor. Ilk IP degeri whitelist icin kullanildi."
      : "x-forwarded-for contains multiple IPs. The first value was used for whitelist guidance.";
  }

  return apiOkFromRequest(request, {
    ip: ipFromOutbound,
    source,
    hint,
    debug: {
      forwardedFor: forwardedFor ?? null,
      realIp: realIp ?? null,
      forwarded: forwarded ?? null,
    },
    checkedAt: new Date().toISOString(),
  });
}

