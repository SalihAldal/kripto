import { withBasePath } from "@/lib/base-path";

function resolveLocaleHeader() {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem("kinetic.locale");
  if (stored === "tr" || stored === "en") return stored;
  return window.navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
}

function buildIdempotencyKey() {
  if (typeof window === "undefined") return `srv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const cryptoApi = window.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type RequestHeaders = HeadersInit | undefined;

function resolveApiTokenHeader(): Record<string, string> {
  const token = (process.env.NEXT_PUBLIC_APP_TOKEN ?? "").trim();
  return token ? { "x-kinetic-token": token } : {};
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (!contentType.includes("application/json")) {
    const brief = raw.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(
      response.ok
        ? `Beklenmeyen API cevabi alindi: ${brief || "bos icerik"}`
        : `API hatasi (${response.status}): ${brief || "json disi cevap"}`,
    );
  }
  const json = JSON.parse(raw) as { ok?: boolean; data?: T; error?: string };
  if (!response.ok || !json.ok) {
    throw new Error(json.error ?? `Request failed (${response.status})`);
  }
  return json.data as T;
}

export async function apiGet<T>(url: string, extraHeaders?: RequestHeaders): Promise<T> {
  const response = await fetch(withBasePath(url), {
    cache: "no-store",
    headers: {
      "x-kinetic-internal": "1",
      "x-kinetic-locale": resolveLocaleHeader(),
      ...resolveApiTokenHeader(),
      ...(extraHeaders ?? {}),
    },
  });
  return parseApiResponse<T>(response);
}

export async function apiPost<T>(url: string, body: unknown, extraHeaders?: RequestHeaders): Promise<T> {
  const response = await fetch(withBasePath(url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kinetic-internal": "1",
      "x-kinetic-locale": resolveLocaleHeader(),
      "x-idempotency-key": buildIdempotencyKey(),
      ...resolveApiTokenHeader(),
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify(body),
  });
  return parseApiResponse<T>(response);
}

export async function apiPut<T>(url: string, body: unknown, extraHeaders?: RequestHeaders): Promise<T> {
  const response = await fetch(withBasePath(url), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-kinetic-internal": "1",
      "x-kinetic-locale": resolveLocaleHeader(),
      "x-idempotency-key": buildIdempotencyKey(),
      ...resolveApiTokenHeader(),
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify(body),
  });
  return parseApiResponse<T>(response);
}
