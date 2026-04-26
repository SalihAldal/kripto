import { describe, expect, it } from "vitest";
import { getIdempotencyKey } from "@/src/server/security/idempotency";
import { sanitizePayload } from "@/src/server/security/request-security";

describe("security utils", () => {
  it("idempotency key'i standart headerlardan okur", () => {
    const headers = new Headers({
      "idempotency-key": "idem-1",
    });
    expect(getIdempotencyKey(headers)).toBe("idem-1");
  });

  it("payload icindeki script-benzeri karakterleri temizler", () => {
    const payload = sanitizePayload({
      symbol: "BTC<TRY>",
      note: "  hello\u0000world  ",
      tags: ["<script>", "safe"],
    });
    expect(payload).toEqual({
      symbol: "BTCTRY",
      note: "helloworld",
      tags: ["script", "safe"],
    });
  });
});
