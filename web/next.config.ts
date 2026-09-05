import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.0.27'],
  // Produce a self-contained build (server.js + minimal node_modules) that can
  // be copied to a low-memory host (e.g. Raspberry Pi) and run with `node
  // server.js` — no `next dev` / on-device compilation, so no OOM.
  output: 'standalone',
  // Trace from the web/ dir (not the repo root) so the standalone output is
  // self-contained at .next/standalone/server.js and the multi-lockfile
  // workspace-root warning is silenced.
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
