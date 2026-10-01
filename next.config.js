/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow an isolated build dir (e.g. for testing) without clobbering `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // better-sqlite3 is a native module; keep it external to the server bundle.
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

module.exports = nextConfig;
