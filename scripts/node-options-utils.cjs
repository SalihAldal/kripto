function tokenizeNodeOptions(raw) {
  if (!raw || typeof raw !== "string") return [];
  const tokens = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"' || ch === "'") {
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (current.trim()) tokens.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function classifyNodeOptionToken(token) {
  const trimmed = String(token ?? "").trim();
  if (!trimmed) return { valid: true, reason: "EMPTY" };
  if (/^--r(=|$)/.test(trimmed) || trimmed === "-r") {
    return { valid: false, reason: "SHORT_REQUIRE_FLAG_NOT_ALLOWED" };
  }
  if (/^--[^=\s]+=$/.test(trimmed)) {
    return { valid: false, reason: "MISSING_OPTION_VALUE" };
  }
  return { valid: true, reason: "OK" };
}

function sanitizeNodeOptions(raw) {
  const tokens = tokenizeNodeOptions(raw);
  const kept = [];
  const removed = [];
  for (const token of tokens) {
    const verdict = classifyNodeOptionToken(token);
    if (verdict.valid) kept.push(token);
    else removed.push({ token, reason: verdict.reason });
  }
  return {
    original: raw ?? "",
    sanitized: kept.join(" "),
    removed,
    valid: removed.length === 0,
  };
}

module.exports = {
  tokenizeNodeOptions,
  classifyNodeOptionToken,
  sanitizeNodeOptions,
};
