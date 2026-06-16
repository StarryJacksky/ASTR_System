import type { NextConfig } from "next";

const CORE = process.env.ASTR_CORE_URL ?? "http://127.0.0.1:8300";

const nextConfig: NextConfig = {
  // 把 /api/core/* 代理到 ASTR Core（:8300），让浏览器同源访问，免 CORS。
  async rewrites() {
    return [{ source: "/api/core/:path*", destination: `${CORE}/:path*` }];
  },
};

export default nextConfig;
