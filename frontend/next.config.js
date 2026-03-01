/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy /api/* requests to the backend (works both locally and on Vercel)
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
