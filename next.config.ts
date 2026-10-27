import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default withWorkflow(nextConfig);
