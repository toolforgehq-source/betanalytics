/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/webhooks/stripe',
        destination: '/api/stripe/webhook',
      },
    ]
  },
};

export default nextConfig;
