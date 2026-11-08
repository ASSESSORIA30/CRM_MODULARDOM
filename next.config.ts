import type { NextConfig } from "next";

// Capçaleres de seguretat per a totes les rutes.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Totes les pantalles del CRM depenen de l'usuari i de l'RLS: renderitzat dinàmic,
  // sense memòria cau de dades entre usuaris.
  cacheComponents: false,
  poweredByHeader: false,
  // pdf.js al servidor (lectura de contractes) es carrega des de node_modules, sense empaquetar
  serverExternalPackages: ["pdfjs-dist"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
