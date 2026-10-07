import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sem isso, o Next.js dev bloqueia HMR quando acessado pelo IP do VPS e o JS da página quebra.
  allowedDevOrigins: ["187.77.55.239"],
  devIndicators: false,
};

export default nextConfig;
