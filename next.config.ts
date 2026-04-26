import type { NextConfig } from "next";
import { env } from "@/lib/config";

const nextConfig: NextConfig = {
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
