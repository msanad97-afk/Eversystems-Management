/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 14.2: required for src/instrumentation.ts register() to run at server boot
  // (where env validation happens). Stable/default from Next 15.
  experimental: {
    instrumentationHook: true,
  },
}

module.exports = nextConfig
