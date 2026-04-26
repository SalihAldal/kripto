import { env } from "@/lib/config";
import { validateStartupConfig } from "@/src/server/startup/validate-startup";

try {
  validateStartupConfig();
  // env parse asagi import aninda zorunlu parse ettigi icin burada sadece bilgi loglaniyor.
  console.log(
    JSON.stringify(
      {
        ok: true,
        nodeEnv: env.NODE_ENV,
        appEnv: env.APP_ENV,
        strict: env.STARTUP_STRICT_ENV,
      },
      null,
      2,
    ),
  );
  process.exit(0);
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: (error as Error).message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
