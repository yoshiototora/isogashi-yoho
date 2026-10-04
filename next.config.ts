import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // サーバーを使わないので、静的なファイル一式（out/）として書き出す
  output: "export",
  // 小さなローカルPNGだけなので最適化は不要
  images: { unoptimized: true },
};

export default nextConfig;
