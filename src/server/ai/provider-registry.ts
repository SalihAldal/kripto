import { env } from "@/lib/config";
import type { AIProviderConfig } from "@/src/types/ai";

export function getProviderConfigs(): AIProviderConfig[] {
  const enabled = env.AI_ENABLED_PROVIDERS.split(",").map((x) => x.trim().toLowerCase());

  const all: AIProviderConfig[] = [
    {
      id: "provider-1",
      name: env.AI_PROVIDER_1_NAME,
      apiKey: env.AI_PROVIDER_1_API_KEY,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      weight: 1.0,
      enabled: enabled.includes("provider-1"),
    },
    {
      id: "provider-2",
      name: env.AI_PROVIDER_2_NAME,
      apiKey: env.AI_PROVIDER_2_API_KEY,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      weight: 1.0,
      enabled: enabled.includes("provider-2"),
    },
    {
      id: "provider-3",
      name: env.AI_PROVIDER_3_NAME,
      apiKey: env.AI_PROVIDER_3_API_KEY,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      weight: 1.0,
      enabled: enabled.includes("provider-3"),
    },
  ];

  return all.filter((x) => x.enabled);
}
