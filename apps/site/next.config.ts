import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The landing is pre-rendered to a static `out/` and served by Caddy, the same
  // way apps/site is served today.
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  // The repo gate typechecks the workspace with `tsc --noEmit -p tsconfig.json`
  // (TypeScript 7), so Next's own build-time type check is redundant.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
