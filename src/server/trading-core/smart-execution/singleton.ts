import { SmartExecutionService } from "@/src/server/trading-core/smart-execution/smart-execution-service";

let service: SmartExecutionService | null = null;

export function getSmartExecutionService() {
  if (!service) service = new SmartExecutionService();
  return service;
}
