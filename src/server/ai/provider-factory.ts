import type { AIProviderAdapter } from "@/src/server/ai/provider.interface";
import type { AIProviderConfig } from "@/src/types/ai";
import { Provider1Adapter } from "@/src/server/ai/providers/provider-1.adapter";
import { Provider2Adapter } from "@/src/server/ai/providers/provider-2.adapter";
import { Provider3Adapter } from "@/src/server/ai/providers/provider-3.adapter";

export function createProviderAdapter(config: AIProviderConfig): AIProviderAdapter {
  switch (config.id) {
    case "provider-1":
      return new Provider1Adapter(config);
    case "provider-2":
      return new Provider2Adapter(config);
    case "provider-3":
      return new Provider3Adapter(config);
    default:
      return new Provider1Adapter({ ...config, id: "provider-1" });
  }
}
