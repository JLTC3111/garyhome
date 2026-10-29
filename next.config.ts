import type { NextConfig } from "next";
import movedAssets from "./data/asset-paths.json";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/shared/gary-apps/v1/:asset*", headers: [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
  async redirects(){return Object.entries(movedAssets).map(([source,destination])=>({source,destination,permanent:true}));}
};

export default nextConfig;
