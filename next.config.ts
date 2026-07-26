import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  env: {
    SEARCH_GROUNDING_MODE: process.env.SEARCH_GROUNDING_MODE ?? "auto",
  },
};

export default withWorkflow(nextConfig);
