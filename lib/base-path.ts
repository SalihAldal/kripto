const normalizedBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

export function getBasePath() {
  return normalizedBasePath;
}

export function withBasePath(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBasePath}${normalized}`;
}
