import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { env } from "@/lib/config";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";

type CheckRow = {
  ok: boolean;
  endpoint: string;
  statusCode: number | null;
  code: string | null;
  message: string | null;
  flags?: {
    canTrade: number | null;
    canWithdraw: number | null;
    canDeposit: number | null;
  };
};
type ApiRestrictionsResult = {
  endpoint: string;
  ok: boolean;
  statusCode: number | null;
  code: string | null;
  message: string | null;
  source: "sapi" | "open" | "unknown";
  flags: {
    enableReading: boolean | null;
    enableSpotAndMarginTrading: boolean | null;
    enableWithdrawals: boolean | null;
    ipRestrict: boolean | null;
  };
};

const BINANCE_API_KEY = (env.BINANCE_API_KEY ?? "").trim();
const BINANCE_API_SECRET = (env.BINANCE_API_SECRET ?? "").trim();
const SERVER_BOOTED_AT = new Date().toISOString();

const OKX_AUTH_ERROR_CODES = new Set([
  "50113", // Invalid signature
  "50114", // Invalid authorization
  "50115", // Invalid request header
  "50116", // Invalid API key
  "50100", // API key does not exist
  "50101", // API key invalid
  "50013", // Permission denied
]);

const OKX_TRADE_REACHABLE_CODES = new Set([
  "51000",
  "51001",
  "51002",
  "51004",
  "51008",
  "51011",
  "51019",
  "51131",
]);

function isPayloadSuccess(code: string | null, message: string | null) {
  if (code === null) return true;
  if (code === "0") return true;
  const normalizedMessage = (message ?? "").toLowerCase();
  if (normalizedMessage.includes("invalid api-key") || code === "-2015" || code === "3701") return false;
  return false;
}

function parseErrorPayload(rawText: string) {
  if (!rawText) return { code: null as string | null, message: null as string | null };
  try {
    const json = JSON.parse(rawText) as {
      code?: string | number;
      msg?: string;
      message?: string;
      data?: {
        canTrade?: string | number;
        canWithdraw?: string | number;
        canDeposit?: string | number;
      };
    };
    return {
      code: json.code !== undefined ? String(json.code) : null,
      message: json.msg ?? json.message ?? rawText,
      flags: {
        canTrade: json.data?.canTrade !== undefined ? Number(json.data.canTrade) : null,
        canWithdraw: json.data?.canWithdraw !== undefined ? Number(json.data.canWithdraw) : null,
        canDeposit: json.data?.canDeposit !== undefined ? Number(json.data.canDeposit) : null,
      },
    };
  } catch {
    return {
      code: null,
      message: rawText,
      flags: {
        canTrade: null,
        canWithdraw: null,
        canDeposit: null,
      },
    };
  }
}

async function signedRequest(method: "GET" | "POST", base: string, path: string, params: Record<string, string>) {
  const normalizedBase = base.replace(/\/+$/, "");
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = new URLSearchParams({ ...params, timestamp, recvWindow }).toString();
  const signature = createHmac("sha256", BINANCE_API_SECRET).update(query).digest("hex");
  const url = `${normalizedBase}${path}?${query}&signature=${signature}`;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "X-MBX-APIKEY": BINANCE_API_KEY,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      cache: "no-store",
    });
    const rawText = await response.text().catch(() => "");
    const parsed = parseErrorPayload(rawText);
    const payloadSuccess = isPayloadSuccess(parsed.code, parsed.message);
    return {
      ok: response.ok && payloadSuccess,
      endpoint: `${normalizedBase}${path}`,
      statusCode: response.status ?? null,
      code: parsed.code,
      message: parsed.message,
      flags: parsed.flags,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: `${normalizedBase}${path}`,
      statusCode: null,
      code: "NETWORK",
      message: (error as Error).message,
      flags: {
        canTrade: null,
        canWithdraw: null,
        canDeposit: null,
      },
    };
  }
}

function parseApiRestrictionsPayload(payload: unknown): ApiRestrictionsResult["flags"] {
  const row = (payload ?? {}) as Record<string, unknown>;
  const normalize = (value: unknown) => (typeof value === "boolean" ? value : value === 1 ? true : value === 0 ? false : null);
  return {
    enableReading: normalize(row.enableReading),
    enableSpotAndMarginTrading: normalize(row.enableSpotAndMarginTrading),
    enableWithdrawals: normalize(row.enableWithdrawals),
    ipRestrict: normalize(row.ipRestrict),
  };
}

async function runApiRestrictionsCheck(): Promise<ApiRestrictionsResult> {
  const candidates = [
    { path: "/sapi/v1/account/apiRestrictions", source: "sapi" as const },
    { path: "/open/v1/account/apiRestrictions", source: "open" as const },
  ];
  let last: ApiRestrictionsResult = {
    endpoint: "",
    ok: false,
    statusCode: null,
    code: null,
    message: null,
    source: "unknown",
    flags: {
      enableReading: null,
      enableSpotAndMarginTrading: null,
      enableWithdrawals: null,
      ipRestrict: null,
    },
  };
  for (const candidate of candidates) {
    const normalizedBase = env.BINANCE_TR_HTTP_BASE.replace(/\/+$/, "");
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const query = new URLSearchParams({ timestamp, recvWindow }).toString();
    const signature = createHmac("sha256", BINANCE_API_SECRET).update(query).digest("hex");
    const endpoint = `${normalizedBase}${candidate.path}`;
    const url = `${endpoint}?${query}&signature=${signature}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-MBX-APIKEY": BINANCE_API_KEY,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      const rawText = await response.text().catch(() => "");
      const parsed = parseErrorPayload(rawText);
      const parsedJson = (() => {
        try {
          return rawText ? (JSON.parse(rawText) as unknown) : null;
        } catch {
          return null;
        }
      })();
      const flags = parseApiRestrictionsPayload(parsedJson);
      const hasAnyFlag = Object.values(flags).some((v) => v !== null);
      const ok = response.ok && (parsed.code === null || parsed.code === "0") && hasAnyFlag;
      const result: ApiRestrictionsResult = {
        endpoint,
        ok,
        statusCode: response.status ?? null,
        code: parsed.code,
        message: parsed.message,
        source: candidate.source,
        flags,
      };
      last = result;
      if (result.ok || result.code === "-2015" || result.code === "3701") return result;
    } catch (error) {
      last = {
        endpoint,
        ok: false,
        statusCode: null,
        code: "NETWORK",
        message: (error as Error).message,
        source: candidate.source,
        flags: {
          enableReading: null,
          enableSpotAndMarginTrading: null,
          enableWithdrawals: null,
          ipRestrict: null,
        },
      };
    }
  }
  return last;
}

function parseOkxFlags(data: unknown) {
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const perm = String(row?.perm ?? "").toLowerCase();
  return {
    canTrade: perm.includes("trade") ? 1 : perm.includes("read_only") ? 0 : null,
    canWithdraw: perm.includes("withdraw") ? 1 : null,
    canDeposit: null,
  };
}

async function okxSignedRequest(
  method: "GET" | "POST",
  path: string,
  query?: Record<string, string | number | undefined>,
  bodyObj?: Record<string, unknown>,
): Promise<CheckRow> {
  const base = "https://www.okx.com";
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const pathWithQuery = qs.toString() ? `${path}?${qs.toString()}` : path;
  const url = `${base}${pathWithQuery}`;
  const timestamp = new Date().toISOString();
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const prehash = `${timestamp}${method}${pathWithQuery}${body}`;
  const signature = createHmac("sha256", env.OKX_API_SECRET ?? "").update(prehash).digest("base64");
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": env.OKX_API_KEY ?? "",
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": env.OKX_API_PASSPHRASE ?? "",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (env.OKX_ENV === "testnet") headers["x-simulated-trading"] = "1";

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      cache: "no-store",
    });
    const raw = (await response.json().catch(() => ({}))) as { code?: string | number; msg?: string; data?: unknown };
    const code = raw.code !== undefined ? String(raw.code) : null;
    return {
      ok: response.ok && code === "0",
      endpoint: url,
      statusCode: response.status ?? null,
      code,
      message: raw.msg ?? null,
      flags: parseOkxFlags(raw.data),
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: url,
      statusCode: null,
      code: "NETWORK",
      message: (error as Error).message,
      flags: {
        canTrade: null,
        canWithdraw: null,
        canDeposit: null,
      },
    };
  }
}

async function runOkxAccountReadCheck() {
  const balance = await okxSignedRequest("GET", "/api/v5/account/balance");
  const config = await okxSignedRequest("GET", "/api/v5/account/config");
  if (config.flags && (config.flags.canTrade !== null || config.flags.canWithdraw !== null)) {
    balance.flags = config.flags;
  }
  return balance.ok ? balance : config.ok ? config : balance;
}

async function runOkxOrderPermissionCheck() {
  const res = await okxSignedRequest("POST", "/api/v5/trade/order-precheck", undefined, {
    instId: "BTC-USDT",
    tdMode: "cash",
    side: "buy",
    ordType: "market",
    sz: "0.0001",
  });
  if (res.ok) return res;
  if (res.code && OKX_TRADE_REACHABLE_CODES.has(res.code)) return { ...res, ok: true };
  return res;
}

async function runAccountReadCheck() {
  const candidates = [{ base: env.BINANCE_TR_HTTP_BASE, path: "/open/v1/account/spot" }];
  let last: CheckRow = {
    ok: false,
    endpoint: "",
    statusCode: null,
    code: null,
    message: null,
  };
  for (const candidate of candidates) {
    const res = await signedRequest("GET", candidate.base, candidate.path, {});
    last = res;
    if (res.ok) return res;
    if (res.code === "-2015" || res.code === "3701") return res;
  }
  return last;
}

async function runOrderPermissionCheck() {
  const candidates: Array<{
    id: string;
    base: string;
    path: string;
    method: "POST";
    params: Record<string, string>;
  }> = [
    {
      id: "tr-cancel-probe",
      base: env.BINANCE_TR_HTTP_BASE,
      path: "/open/v1/orders/cancel",
      method: "POST" as const,
      params: { orderId: "0" },
    },
    {
      id: "mbx-test-order",
      base: env.BINANCE_TR_HTTP_BASE,
      path: "/api/v3/order/test",
      method: "POST" as const,
      params: {
        symbol: "BTCTRY",
        side: "BUY",
        type: "MARKET",
        quoteOrderQty: "100",
      },
    },
  ];
  let last: CheckRow = {
    ok: false,
    endpoint: "",
    statusCode: null,
    code: null,
    message: null,
  };
  for (const candidate of candidates) {
    const res = await signedRequest(candidate.method, candidate.base, candidate.path, candidate.params);
    last = res;
    if (res.ok) return res;
    if (res.code === "-2015" || res.code === "3701") return res;
    // Non-auth errors still mean signed trade endpoint is reachable.
    if (res.code && res.code !== "NETWORK") {
      return { ...res, ok: true };
    }
  }
  return last;
}

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    if (env.EXCHANGE_PROVIDER === "okx") {
      if (!env.OKX_API_KEY || !env.OKX_API_SECRET || !env.OKX_API_PASSPHRASE) {
        return apiOkFromRequest(request, {
          ok: false,
          platform: "okx",
          checkedAt: new Date().toISOString(),
          reason: tr ? "OKX API key/secret/passphrase eksik." : "Missing OKX API key/secret/passphrase.",
        });
      }
      const accountRead = await runOkxAccountReadCheck();
      const tradePermission = await runOkxOrderPermissionCheck();
      const ok = accountRead.ok && tradePermission.ok;
      const networkFail = accountRead.code === "NETWORK" || tradePermission.code === "NETWORK";
      const tradeAuthFail = Boolean(tradePermission.code && OKX_AUTH_ERROR_CODES.has(tradePermission.code));
      const hint = networkFail
        ? tr
          ? "OKX baglantisi ag tarafinda kesiliyor olabilir. DNS/VPN/Firewall kontrol et."
          : "OKX connectivity appears unstable. Check DNS/VPN/Firewall."
        : tradeAuthFail
          ? tr
            ? "OKX API yetkisi trade endpointinde reddedildi. API permissions ve IP whitelist ayarlarini kontrol et."
            : "OKX API permission is rejected on trade endpoint. Check API permissions and IP whitelist."
          : tr
            ? "OKX endpoint yaniti alindi. Kod detaylarini kontrol et."
            : "OKX endpoint responded. Check response codes.";
      const actions = tradeAuthFail
        ? [
            tr ? "OKX > API Management > Trade iznini ac." : "Enable Trade permission in OKX API Management.",
            tr ? "IP whitelist aktifse guncel public IP'yi tekrar ekle." : "If IP whitelist is enabled, re-add current public IP.",
            tr ? "API key passphrase degerini .env ile birebir kontrol et." : "Verify API passphrase matches .env exactly.",
          ]
        : [
            tr ? "OKX API key/secret/passphrase degerlerini yeniden olusturup .env'ye gir." : "Regenerate OKX API credentials and update .env.",
            tr ? "Agi degistirip tekrar dene (hotspot/alternatif internet)." : "Retry from another network (hotspot/alternative ISP).",
          ];
      return apiOkFromRequest(request, {
        ok,
        platform: "okx",
        accountRead,
        tradePermission,
        checkedAt: new Date().toISOString(),
        reason: ok
          ? tr
            ? "OKX hesap okuma ve trade permission dogrulandi."
            : "OKX account read and trade permission verified."
          : tr
            ? "OKX auth test basarisiz. accountRead/tradePermission detaylarini kontrol et."
            : "OKX auth test failed. Check accountRead/tradePermission details.",
        hint,
        actions,
      });
    }

    if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
      return apiOkFromRequest(request, {
        ok: false,
        reason: tr ? "API key/secret eksik." : "Missing API key/secret.",
      });
    }

    const accountRead = await runAccountReadCheck();
    const tradePermission = await runOrderPermissionCheck();
    const apiRestrictions = await runApiRestrictionsCheck();
    // Binance TR tarafinda "account read" endpoint davranisi degisken olabilir.
    // Islem yapilabilirlik icin karar kriterini trade permission uzerinden veriyoruz.
    const ok = tradePermission.ok;
    const accountAuthFail = !accountRead.ok && (accountRead.code === "-2015" || accountRead.code === "3701");
    const tradeDenied3701 = tradePermission.code === "3701";
    const tradeAuthFail = !tradePermission.ok && (tradePermission.code === "-2015" || tradePermission.code === "3701");
    const networkFail = accountRead.code === "NETWORK" || tradePermission.code === "NETWORK";
    const hint =
      networkFail
        ? tr
          ? "www.binance.tr erisimi ag tarafinda kesiliyor olabilir. MBX fallback denendi; DNS/VPN/Firewall kontrol et."
          : "www.binance.tr connectivity seems blocked/intermittent. MBX fallback was attempted; check DNS/VPN/Firewall."
        :
      tradeDenied3701 && accountRead.ok
        ? tr
          ? "Whitelist IP dogru gorunuyor (account read basarili), ancak trade endpoint 3701 donuyor. Bu durumda odak API key Spot Trade izni ve key guncellemesi olmali."
          : "Whitelist IP likely looks correct (account read is successful), but trade endpoint returns 3701. Focus on Spot Trade permission and key regeneration."
      : tradeAuthFail
        ? tr
          ? "Islem izni kapali veya kisitli. Binance TR API key ayarlarinda Spot Trade (al-sat) iznini ac, key'i yeniden kaydet ve 1-2 dk sonra tekrar dene."
          : "Trade permission is disabled/restricted. Enable Spot Trade on Binance TR API key settings, save again, and retry after 1-2 minutes."
        : accountAuthFail
          ? tr
            ? "API key/secret veya whitelist IP uyumsuz. Dinamik IP kullaniyorsan sabit IP/VPN ile whitelist'i guncelle."
            : "API key/secret or whitelist IP mismatch. If your public IP is dynamic, update whitelist using a fixed IP/VPN."
          : tradePermission.ok && !accountRead.ok
            ? tr
              ? "Islem izni dogrulandi. Account read endpointindeki hata Binance TR endpoint davranisindan kaynakli olabilir; canli al-sat engeli olarak degerlendirme."
              : "Trade permission is verified. Account-read endpoint issues can come from Binance TR endpoint behavior; do not treat this as a live trading blocker."
          : tr
            ? "Yetki testi basarisiz. Endpoint kodlarini kontrol et."
            : "Auth test failed. Check endpoint codes.";
    const actions =
      tradeDenied3701 && accountRead.ok
        ? [
            tr ? "Whitelist tarafi buyuk olasilikla dogru; ayni IP ile devam edebilirsin." : "Whitelist is likely correct; keep using the same IP.",
            tr ? "Yeni Binance TR API key olustur ve Spot Trade iznini acik birak." : "Create a new Binance TR API key and keep Spot Trade enabled.",
            tr ? "Yeni key/secret'i .env'ye yazip servisi yeniden baslat." : "Update .env with the new key/secret and restart the service.",
          ]
      : tradeAuthFail
        ? [
            tr ? "Binance TR > API Management > ilgili key > Spot Trade iznini ac." : "Enable Spot Trade permission.",
            tr ? "Key'i kaydet, 1-2 dk bekle." : "Save key settings and wait 1-2 minutes.",
            tr ? "Whitelist'e mevcut public IPv4 adresini tekrar ekle." : "Re-add current public IPv4 to whitelist.",
          ]
        : [
            tr ? "API key/secret degerlerini yeniden olusturup .env'ye gir." : "Regenerate API key/secret and update .env.",
            tr ? "Whitelist IP'yi guncelle (dinamik IP degisimi olabilir)." : "Update whitelist IP (public IP may change).",
          ];
    const normalizedHint = ok ? undefined : hint;
    const normalizedActions = ok ? undefined : actions;

    return apiOkFromRequest(request, {
      ok,
      platform: "binance-tr",
      accountRead,
      tradePermission,
      diagnostics: {
        keyConfigured: BINANCE_API_KEY.length > 0,
        secretConfigured: BINANCE_API_SECRET.length > 0,
        keyEdgeWhitespace: (env.BINANCE_API_KEY ?? "") !== BINANCE_API_KEY,
        secretEdgeWhitespace: (env.BINANCE_API_SECRET ?? "") !== BINANCE_API_SECRET,
        env: env.BINANCE_ENV,
        serverBootedAt: SERVER_BOOTED_AT,
        pid: process.pid,
        apiRestrictions,
      },
      checkedAt: new Date().toISOString(),
      reason: ok
        ? tr
          ? accountRead.ok
            ? "Emir yetkisi dogrulandi. Account read ve trade endpointleri erisilebilir."
            : "Emir yetkisi dogrulandi. Account read endpointindeki hata islem engeli olarak degerlendirilmedi."
          : accountRead.ok
            ? "Trade permission verified. Account-read and trade endpoints are reachable."
            : "Trade permission verified. Account-read endpoint issue is not treated as a trading blocker."
        : tr
          ? "Yetki testi basarisiz. accountRead/tradePermission detaylarini kontrol et."
          : "Auth test failed. Check accountRead/tradePermission details.",
      hint: normalizedHint,
      actions: normalizedActions,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

