import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // The public home page is a standalone page built with the taste-skill kit
      // (frontend/public/home/index.html, its own CSS and scripts). "beforeFiles" lets it win over app/.
      beforeFiles: [{ source: "/", destination: "/home/index.html" }],
    };
  },
};

export default nextConfig;
