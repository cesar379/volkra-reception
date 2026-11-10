import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (Postgres embebido para el modo local) carga ficheros WASM: no se empaqueta.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: { "/**": ["./supabase/migrations/**", "./supabase/local/**"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  poweredByHeader: false,
};

export default nextConfig;
