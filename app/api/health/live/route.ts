import { apiOk } from "@/lib/api";

export async function GET() {
  return apiOk({
    status: "live",
    timestamp: new Date().toISOString(),
  });
}
