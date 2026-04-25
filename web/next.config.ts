import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  allowedDevOrigins: ["192.168.1.252", "localhost", "0.0.0.0"],
};

export default nextConfig;
