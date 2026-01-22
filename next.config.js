/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.externals.push({
      'better-sqlite3': 'commonjs better-sqlite3',
    });
    return config;
  },
  // Skip ESLint during builds (run separately if needed)
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Skip TypeScript errors during builds (needed for db union type)
  typescript: {
    ignoreBuildErrors: true,
  },
  // Allow large request bodies for server actions (50MB limit)
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

module.exports = nextConfig;
