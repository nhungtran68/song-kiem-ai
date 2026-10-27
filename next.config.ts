import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  experimental: {
    cpus: 2,
  },
  outputFileTracingIncludes: {
    "/*": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default withWorkflow(nextConfig);
