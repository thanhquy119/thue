import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
};

export default withWorkflow(nextConfig);
