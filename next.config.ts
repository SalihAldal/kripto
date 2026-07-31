import type { NextConfig } from "next";
import { env } from "@/lib/config";

const basePath = (process.env.NEXT_BASE_PATH ?? "").trim().replace(/\/$/, "");

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: !env.NEXT_DISABLE_BROWSER_SOURCEMAPS,
  allowedDevOrigins: [
    "yoneticidemo.surucukursu.local",
    "yonetici.surucukursu.local",
  ],
};

export default nextConfig;
