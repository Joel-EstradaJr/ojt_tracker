/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow API calls to the backend during development
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:4000/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
