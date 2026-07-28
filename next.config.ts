import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Product imagery served from the public Supabase storage buckets.
      ...(supabaseHost
        ? ([
            {
              protocol: "https" as const,
              hostname: supabaseHost,
              pathname: "/storage/v1/object/public/**",
            },
          ])
        : []),
      // Imported catalogues keep pointing at the source CDN: a Shopify product
      // export carries image URLs, not image files, so a product imported by
      // CSV has no copy in our own bucket and would render as a broken tile
      // without this. Products created here still upload to Supabase Storage.
      { protocol: "https", hostname: "cdn.shopify.com" },
      // Placeholder catalog photography from the seed migration. Remove once
      // real product shots are uploaded to the product-images bucket.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
    ],
  },
};

export default nextConfig;
