import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  // Native/Node-heavy libraries used only on the server.
  serverExternalPackages: ["@react-pdf/renderer", "xlsx", "unpdf"],
  // Read from disk at runtime (PDF fonts, sample RFQ packs, the demo seed's register): ship them on Vercel.
  outputFileTracingIncludes: {
    "/**": ["./src/server/pdf/fonts/**/*", "./sample-data/rfq-packs/**/*", "./sample-data/past-quotes-2023-2026.xlsx"],
  },
  poweredByHeader: false,
  async headers() {
    // File and PDF routes set their own framing policy (same-origin preview of drawings and quotes).
    return [{ source: "/((?!api/files|api/quotes).*)", headers: securityHeaders }];
  },
};

export default nextConfig;
