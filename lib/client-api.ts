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

export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "x-kinetic-internal": "1",
      "x-kinetic-locale": resolveLocaleHeader(),
    },
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error ?? "Request failed");
  }
  return json.data as T;
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kinetic-internal": "1",
      "x-kinetic-locale": resolveLocaleHeader(),
      "x-idempotency-key": buildIdempotencyKey(),
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error ?? "Request failed");
  }
  return json.data as T;
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-kinetic-internal": "1",
      "x-kinetic-locale": resolveLocaleHeader(),
      "x-idempotency-key": buildIdempotencyKey(),
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error ?? "Request failed");
  }
  return json.data as T;
}
