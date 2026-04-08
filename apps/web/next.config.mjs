/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent webpack from bundling these server-only packages.
  // Prisma's generated client embeds large schema strings (215 kiB+) that
  // trigger the "Serializing big strings impacts deserialization performance"
  // webpack cache warning when bundled. Marking them external means Node.js
  // loads them directly from node_modules at runtime instead.
  serverExternalPackages: [
    '@prisma/client',
    'prisma',
    '@prisma/adapter-pg',
    'nodemailer',
  ],
};

export default nextConfig;
