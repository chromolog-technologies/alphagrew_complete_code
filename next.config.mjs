/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['unpdf', 'tesseract.js']
};

export default nextConfig;
