/** @type {import('next').NextConfig} */
const nextConfig = {
  // @farol/shared é publicado como TypeScript (main: src/index.ts)
  transpilePackages: ["@farol/shared"],
};

export default nextConfig;
