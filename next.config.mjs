// The dashboard is one app behind the platform gateway, which owns "/" and
// serves the app index there. Everything here nests under /weather: Next
// rewrites its own routes, links and assets, and NEXT_PUBLIC_BASE_PATH carries
// the same prefix to client fetches, which Next does not rewrite.
const basePath = "/weather";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
