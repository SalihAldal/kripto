import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getWalletDetails } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { listWalletsByTag } from "@/src/server/whale-intelligence/wallet-intelligence.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const address = request.nextUrl.searchParams.get("address") ?? undefined;
    const chain = request.nextUrl.searchParams.get("chain") ?? undefined;
    const tagType = request.nextUrl.searchParams.get("tagType") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);

    if (address) {
      const wallet = await getWalletDetails(address, chain);
      return apiOkFromRequest(request, { wallet });
    }

    const wallets = await listWalletsByTag(tagType, limit);
    return apiOkFromRequest(request, { wallets, count: wallets.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
