import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // The widget script is embedded on clinic websites, so it must be cacheable but never stale for long.
  async headers() {
    return [
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
