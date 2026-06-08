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
    // tsc --noEmit is clean (0 errors) and the CI ratchet holds it there, so the
    // build now type-checks for real — type regressions can't reach the team.
    ignoreBuildErrors: false,
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
