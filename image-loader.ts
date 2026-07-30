import type { ImageLoaderProps } from "next/image";

/**
 * Every image this storefront serves already lives behind a CDN that resizes on
 * its own edge: product shots imported from Shopify sit on `cdn.shopify.com`,
 * anything uploaded through the admin sits in Supabase Storage, which exposes a
 * `/render/image/` transform endpoint. Next's built-in optimiser would proxy all
 * of it through our own server — one hop that turns into the bottleneck and the
 * bill the moment a drop puts a thousand people on the site at once.
 *
 * So we opt out and hand each URL back to the CDN that already owns the bytes.
 * The Next server never reads, resizes or caches an image; it only ever emits a
 * `srcset` of third-party URLs. `next/image` still does everything we actually
 * want from it — width negotiation, lazy loading, aspect-ratio reservation.
 *
 * Measured on this catalogue:
 *   Supabase original 1396 KB → 17 KB at w=400 q=70 (auto-WebP via Accept)
 *   Shopify original   231 KB → 60 KB at w=400
 *
 * Anything we don't recognise is returned untouched rather than guessed at, so
 * an unknown host degrades to "full size but working" instead of a broken tile.
 */

/** Supabase rejects a transform above this on either axis. */
const SUPABASE_MAX_EDGE = 2500;

/** Shopify's CDN caps resizes here; beyond it the param is ignored. */
const SHOPIFY_MAX_EDGE = 5760;

/** Marks a Supabase Storage object URL, whatever project or custom domain it's on. */
const SUPABASE_OBJECT_PATH = "/storage/v1/object/public/";
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/";

function isShopifyCdn(hostname: string): boolean {
  return hostname === "cdn.shopify.com" || hostname.endsWith(".shopifycdn.com");
}

export default function imageLoader({ src, width, quality }: ImageLoaderProps): string {
  // Object URLs for a file the operator just dropped, and inlined data URIs,
  // are already local bytes — rewriting them would only break the preview.
  if (src.startsWith("blob:") || src.startsWith("data:")) return src;

  // Relative paths are our own brand art in /public. It ships pre-compressed to
  // WebP at delivery size (see scripts/optimize-public-images.mjs) and is art
  // directed per breakpoint in the content modules, so there is nothing left to
  // negotiate — serving the file as-is keeps it a plain static CDN hit.
  if (src.startsWith("/")) return src;

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }

  // Supabase Storage: swap the raw-object path for the transform path. Already
  // transformed URLs fall through to the same param assignment, so calling this
  // twice is a no-op rather than a double prefix.
  if (url.pathname.includes(SUPABASE_OBJECT_PATH) || url.pathname.includes(SUPABASE_RENDER_PATH)) {
    url.pathname = url.pathname.replace(SUPABASE_OBJECT_PATH, SUPABASE_RENDER_PATH);
    url.searchParams.set("width", String(Math.min(width, SUPABASE_MAX_EDGE)));
    url.searchParams.set("quality", String(quality ?? 75));
    // No `format` param on purpose: left alone, Supabase negotiates WebP from
    // the request's Accept header and falls back to the original for browsers
    // that can't take it. Pinning a format would cost us that.
    return url.href;
  }

  // Shopify's CDN takes a `width` param and already answers in WebP. It gets no
  // `quality` — that param doesn't exist there, and unknown params would only
  // fragment their edge cache for no gain. The `v=` cache buster is preserved.
  if (isShopifyCdn(url.hostname)) {
    url.searchParams.set("width", String(Math.min(width, SHOPIFY_MAX_EDGE)));
    return url.href;
  }

  return src;
}
