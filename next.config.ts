import type { NextConfig } from "next";
import movedAssets from "./data/asset-paths.json";

const nextConfig: NextConfig = {
  async redirects(){return Object.entries(movedAssets).map(([source,destination])=>({source,destination,permanent:true}));}
};

export default nextConfig;
