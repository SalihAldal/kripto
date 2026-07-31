import { appConfig } from "@/src/config/app.config";
import { validateStartupConfig } from "@/src/server/startup/validate-startup";

export function bootstrapServer() {
  validateStartupConfig();
  return {
    name: appConfig.appName,
    env: appConfig.environment,
    startedAt: new Date().toISOString(),
  };
}
