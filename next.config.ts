import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // The widget script is embedded on clinic websites, so it must be cacheable but never stale for long.
  async headers() {
    return [
      // the service worker must always be re-checked, or a bad one could never be replaced
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      {
        source: "/widget.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
