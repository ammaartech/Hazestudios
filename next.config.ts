import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  // Partial Prerendering, and the `use cache` directive that feeds it.
  //
  // The storefront's whole problem was that a page every visitor sees
  // identically — one hoodie, one price, one gallery — was being rendered from
  // scratch per request because a single cookie read in the layout dragged the
  // entire route into dynamic rendering. Cache Components inverts that: the
  // page is prerendered into a static shell, and only the parts that genuinely
  // depend on *this* shopper (the cart) stream in behind a Suspense boundary.
  //
  // The cost is that nothing is dynamic by accident any more. Reading
  // `cookies()`, `headers()` or `searchParams` outside a boundary is now a
  // build error rather than a silent deopt, which is the point.
  cacheComponents: true,

  cacheLife: {
    /**
     * The profile every storefront catalogue read uses.
     *
     * `revalidate: 60` is a backstop, not the freshness mechanism — admin
     * writes call `updateTag` and expire the affected entries immediately (see
     * `src/lib/shop/cache.ts`). Sixty seconds is what covers a change that
     * arrives *without* passing through a Server Action: a direct SQL edit, a
     * tweak in the Supabase dashboard.
     *
     * `stale: 300` is the client router's cache, and it is the single biggest
     * lever for the shoppers we care about most. On a slow phone, a shopper
     * going PDP → collection → back pays nothing for the return trip: the
     * router replays it from memory with no network at all. The cost is that a
     * price changed mid-session can take up to five minutes to reach a tab that
     * is already open, which for this catalogue is the right side of the trade.
     *
     * `expire: 3600` bounds how long an untouched entry may be served after a
     * quiet spell before someone has to wait for a fresh read.
     *
     * These numbers currently coincide with the built-in `minutes` preset. The
     * named profile is kept anyway: `cacheLife("catalog")` says what the data
     * *is* at eleven call sites, and tuning the storefront's freshness later is
     * a one-line change here rather than an audit of who meant which minute.
     */
    catalog: {
      stale: 300,
      revalidate: 60,
      expire: 3600,
    },
  },

  images: {
    // Image bytes never touch our server: `image-loader.ts` rewrites each URL to
    // the transform endpoint of whichever CDN already stores it. See that file
    // for the reasoning — in short, the built-in optimiser is a per-request
    // resize on the origin, which is precisely the wrong thing to own during a
    // drop. Everything below still applies, because the loader only chooses the
    // host: `next/image` is what decides *which widths* to ask for.
    loader: "custom",
    loaderFile: "./image-loader.ts",

    // The rendition ladder. Every entry is a distinct object the CDN has to
    // generate and cache, so a wide ladder quietly shreds the edge hit-rate —
    // the one number that decides whether a thousand concurrent shoppers are
    // served from cache or from an origin resize. These are deliberately
    // narrower than the Next defaults (8 + 7 = 15 rungs, down to 6 + 5 = 11).
    //
    // Top rung is 2400 rather than a round 2560 because Supabase refuses a
    // transform over 2500px on either axis; asking for a width it will clamp
    // would mean shipping a `srcset` that lies about what arrives.
    deviceSizes: [640, 828, 1080, 1440, 1920, 2400],
    // Only used by images that pass `sizes`, i.e. anything narrower than the
    // viewport: cards, cart lines, admin thumbnails. All below the 640 floor.
    imageSizes: [64, 128, 256, 384, 512],

    // Required from Next 16 — an open quality range lets anyone mint arbitrary
    // transforms against our CDN quota. Three rungs, for the same cache-hit
    // reason as the widths: 60 for admin thumbnails nobody pixel-peeps, 75 for
    // the storefront, 90 for PDP photography where fabric texture is the sale.
    qualities: [60, 75, 90],

    remotePatterns: [
      // Product imagery served from the public Supabase storage buckets.
      ...(supabaseHost
        ? ([
            {
              protocol: "https" as const,
              hostname: supabaseHost,
              pathname: "/storage/v1/**",
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
