/** @type {import('next').NextConfig} */
const ACA_URL = 'https://dataflow.delightfulbeach-10f489d6.eastus2.azurecontainerapps.io';

const nextConfig = {
  output: 'standalone',
  webpack: (config) => {
    config.externals.push({
      'better-sqlite3': 'commonjs better-sqlite3',
    });
    return config;
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  async rewrites() {
    if (!process.env.VERCEL) return [];
    return {
      beforeFiles: [
        { source: '/api/:path*', destination: `${ACA_URL}/api/:path*` },
      ],
    };
  },
};

module.exports = nextConfig;
