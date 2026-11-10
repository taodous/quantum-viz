import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Python runner is copied into each sandbox by the API functions (lib/server/runnerFiles.ts).
  outputFileTracingIncludes: {
    "/api/run": ["./runner/qrunner/*.py"],
    "/api/session": ["./runner/qrunner/*.py"],
  },
};

export default nextConfig;
