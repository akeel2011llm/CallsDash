import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Client workspace (docs/reorganization.md): pages that moved under a tab keep answering at their old address.
  async redirects() {
    return [
      { source: "/admin/clients/:id/branding", destination: "/admin/clients/:id/business/branding", permanent: false },
      { source: "/admin/clients/:id/duplicate", destination: "/admin/clients/:id/activity/duplicate", permanent: false },
    ];
  },
  // The widget script is embedded on clinic websites, so it must be cacheable but never stale for long.
  async headers() {
    return [
      // the service worker must always be re-checked, or a bad one could never be replaced
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      {
        source: "/widget.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
