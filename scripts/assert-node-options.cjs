const { sanitizeNodeOptions } = require("./node-options-utils.cjs");

function main() {
  const raw = process.env.NODE_OPTIONS ?? "";
  const result = sanitizeNodeOptions(raw);
  if (!result.valid) {
    const details = result.removed.map((row) => `${row.token}(${row.reason})`).join(", ");
    console.error(`[INVALID_NODE_OPTIONS] Unsupported NODE_OPTIONS tokens detected: ${details}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[NODE_OPTIONS_OK] ${result.sanitized || "<empty>"}`);
}

main();
