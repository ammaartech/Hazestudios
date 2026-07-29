/**
 * Editorial content for the storefront chrome and home page.
 *
 * This mirrors the Fogstores Shopify theme (Palo Alto) section-for-section:
 * everything a merchandiser types — menu labels, campaign copy, artwork — lives
 * here. Everything a merchandiser *sells* comes out of Supabase: the sections
 * below name collection and product handles, and the page resolves them at
 * request time. Nothing in this file hardcodes a price or a product title.
 *
 * Artwork is served from `public/fogstores/`. Swap a file in place to re-shoot a
 * section; no component needs to change.
 */

/* -------------------------------------------------------------------------- */
/* Announcement bar                                                            */
/* -------------------------------------------------------------------------- */

export type AnnouncementIcon = "package" | "gem" | "heart";

export interface Announcement {
  icon: AnnouncementIcon;
  text: string;
}

/**
 * The bar scrolls as a marquee, so this list is duplicated at render time until
 * it overflows the viewport. Three to five short lines reads best; more than
 * that and an individual message is off-screen too long to be read.
 */
export const ANNOUNCEMENTS: Announcement[] = [
  { icon: "heart", text: "5% off on prepaid orders" },
  { icon: "package", text: "Returns extended to 7 days" },
  { icon: "gem", text: "25,000+ customers" },
];

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

export interface NavLink {
  label: string;
  /** Collection handle, resolved to `/collections/<handle>`. */
  handle: string;
  /**
   * Set where the destination is an authored landing page rather than a
   * collection in the catalogue. Such a link is exempt from the published-
   * collection check, since there is no collection behind it to check.
   */
  page?: boolean;
  /** Optional second line under the link in the mega-menu panel. */
  note?: string;
}

export interface NavGroup {
  label: string;
  /** Where the group heading itself points. Omit for a dropdown-only trigger. */
  handle?: string;
  children: NavLink[];
}

/**
 * The mega-menu tree.
 *
 * Handles are resolved against the published collections in Supabase — a link
 * whose collection does not exist (or is not published) is dropped, and a group
 * left with no children is dropped with it. So this can carry the full intended
 * menu while the catalogue is still being built out: entries light up as the
 * collections behind them go live.
 */
export const NAV: NavGroup[] = [
  {
    label: "It Girl",
    children: [
      { label: "Shell and Sequins", handle: "shell-and-sequins" },
      { label: "Tube & Tanks", handle: "tube-and-tanks" },
      { label: "Chatpata Tops", handle: "chatpata-tops" },
      { label: "Accessories", handle: "summer-accessories" },
      { label: "Bottoms", handle: "bottoms" },
      { label: "All Summer Sands", handle: "summer-sands" },
    ],
  },
  {
    label: "Y2K Cnty Pieces",
    children: [
      { label: "Mini-Skirts", handle: "mini-skirts" },
      // The live "Siren Muse" is the fall-2025 collection. A `siren-muse`
      // handle also exists but is titled "Siren Muse old" — pointing at it
      // serves the retired edit.
      { label: "Siren Muse", handle: "fall-2025" },
      { label: "Baby Tees", handle: "babytees" },
      { label: "Tops", handle: "tops" },
    ],
  },
  {
    label: "Men",
    children: [
      { label: "Haze Studios", handle: "haze-studios", page: true },
      { label: "Racing Jackets", handle: "jackets" },
    ],
  },
  {
    label: "Sale",
    children: [
      { label: "Soft Girl", handle: "coquette", note: "Baby Doll Tops & more" },
      { label: "Grunge", handle: "grunge" },
      { label: "Y2K Sale", handle: "limited-offers" },
    ],
  },
];

/**
 * Utility links in the search panel and the footer's second column.
 *
 * Shipping and Cash On Delivery are content pages (`/pages/…`); the four legal
 * policies live under `/policies/…` and can be overridden per-store from the
 * admin. Both are served by real routes — see `src/lib/shop/store-pages.ts`.
 */
export const QUICK_LINKS = [
  { label: "Sign In", href: "/account/login" },
  { label: "Exchange & Shop Credit", href: "/account/help" },
  { label: "Shipping Policy", href: "/pages/shipping-policy" },
  { label: "Cash On Delivery Policy", href: "/pages/cash-on-delivery-policy" },
  { label: "Terms of Service", href: "/policies/terms-of-service" },
  { label: "Privacy Policy", href: "/policies/privacy-policy" },
];

export const FOOTER_LINKS = [
  { label: "Home", href: "/" },
  { label: "Refund Policy", href: "/policies/refund-policy" },
];

export const BRAND_INSTAGRAMS = [
  { handle: "@fogstores.co", href: "https://instagram.com/fogstores.co" },
  { handle: "@hazestudios.in", href: "https://www.instagram.com/hazestudios.in" },
  { handle: "@summersands.co", href: "https://instagram.com/summersands.co" },
];

export const NEWSLETTER = {
  heading: "Sign up to get 10%",
  body: "Stay up to date with the new collections, products and exclusive offers on our next drop.",
};

/* -------------------------------------------------------------------------- */
/* Home page — section 1: the shortcut row                                     */
/* -------------------------------------------------------------------------- */

/**
 * The two square shortcuts that sit between the header and the campaign banner.
 * Deliberately short: this row is a shortcut to the two highest-intent
 * destinations, not a second navigation.
 */
export const SHORTCUTS = [
  { label: "Sale", href: "/collections/limited-offers" },
  { label: "Men", href: "/collections/haze-studios" },
];

/* -------------------------------------------------------------------------- */
/* Home page — section 2: the campaign banner                                  */
/* -------------------------------------------------------------------------- */

export interface HeroContent {
  eyebrow: string;
  heading: string;
  body: string;
  cta: { label: string; href: string };
  /** Two crops: the desktop banner is a 2.5:1 letterbox, the mobile one square. */
  image: string;
  imageMobile: string;
}

export const HERO: HeroContent = {
  eyebrow: "Fogstores",
  heading: "Siren Muse",
  body: "Mini-Skirts, Boots, Studs & All Things Hot.",
  cta: { label: "Fall 2026", href: "/collections/siren-muse" },
  image: "/fogstores/hero-desktop.png",
  imageMobile: "/fogstores/hero-mobile.png",
};

/* -------------------------------------------------------------------------- */
/* Home page — section 3: shop the look                                        */
/* -------------------------------------------------------------------------- */

export interface LookFrame {
  image: string;
  alt: string;
  /** Product handle behind the button. */
  handle: string;
  cta: string;
}

export const MOST_TRENDING_EYEBROW = "Most trending";

/**
 * Four styling frames, each shoppable. On a phone the row becomes a scroll rail
 * rather than four unreadably narrow columns.
 */
export const SHOP_THE_LOOK: LookFrame[] = [
  {
    image: "/fogstores/look-1.jpg",
    alt: "Shell skirt styled with a cropped knit",
    handle: "shell-skirt",
    cta: "Shop the look",
  },
  {
    image: "/fogstores/look-2.jpg",
    alt: "Sea shell top worn on the beach",
    handle: "sea-shell-top",
    cta: "Shop the look",
  },
  {
    image: "/fogstores/look-3.png",
    alt: "Gingham dress styled with boots",
    handle: "gingham-dress",
    cta: "Shop the look",
  },
  {
    image: "/fogstores/look-4.jpg",
    alt: "Cherry red cowboy boots",
    handle: "cherry-red-cowboy-boots",
    cta: "Shop the look",
  },
];

/* -------------------------------------------------------------------------- */
/* Home page — the closing mosaic                                              */
/* -------------------------------------------------------------------------- */

/**
 * Campaign artwork referenced straight off the Shopify CDN rather than copied
 * into `public/`. The catalogue behind this storefront was imported from a
 * Shopify export, so every product already renders from that origin (see the
 * `cdn.shopify.com` entry in `next.config.ts`). `&width=` is Shopify's own
 * transform, so each frame pulls a crop sized for its slot.
 */
const CDN = "https://cdn.shopify.com/s/files/1/0633/6105/6992/files";

export interface MosaicTile {
  eyebrow: string;
  heading: string;
  body: string;
  cta: string;
  /** Collection handle, resolved to `/collections/<handle>`. */
  handle: string;
  image: string;
  alt: string;
}

/**
 * The Haze Studios block that closes the page — the menswear label carried
 * alongside Fogstores, split into the three doors the campaign uses.
 */
export const MOSAIC: MosaicTile[] = [
  {
    eyebrow: "Haze Studios",
    heading: "Campus Fits",
    body: "The full menswear label",
    cta: "Shop Now",
    handle: "haze-studios",
    image: `${CDN}/White_Back_a78c26a8-6cb4-4e49-85dc-6f859917592b.png?v=1773642913&width=1200`,
    alt: "Boomy oversized tee, back view",
  },
  {
    eyebrow: "Warm up",
    heading: "Hoodies",
    body: "Heavyweight fleece, boxy cut",
    cta: "Shop Now",
    handle: "haze-hoodies",
    image: `${CDN}/IMG_0143.jpg?v=1668192684&width=1200`,
    alt: "Text Me When You Get Home hoodie",
  },
  {
    eyebrow: "Everyday",
    heading: "Boxy Tees",
    body: "Oversized graphics and blanks",
    cta: "Shop Now",
    handle: "haze-tees",
    image: `${CDN}/Back_White_W_685889af-8401-400c-a84f-f78138a06964.png?v=1729192763&width=1200`,
    alt: "Blond graphic tee, back view",
  },
];

/* -------------------------------------------------------------------------- */
/* Home page — the merchandised collection blocks                              */
/* -------------------------------------------------------------------------- */

export interface FeaturedCollection {
  /** Collection handle, resolved against Supabase at request time. */
  handle: string;
  /** Falls back to the collection's own title when omitted. */
  heading?: string;
  /** The Space Mono caps label above the heading. */
  eyebrow?: string;
  /** Supporting line under the heading. */
  body?: string;
  /** Centred blocks put the CTA underneath; left-aligned blocks put it inline. */
  align: "center" | "left";
  cta?: string;
  /** How many products to show. Four fills one desktop row. */
  limit: number;
}

/** The two centred blocks that sit above the shoppable reel. */
export const FEATURED_TOP: FeaturedCollection[] = [
  {
    handle: "fall-2025",
    heading: "The Festival Edit",
    eyebrow: "Studs. Tanks. Boots. Rhinestones.",
    align: "center",
    cta: "Shop Now",
    limit: 4,
  },
  {
    handle: "shell-and-sequins",
    heading: "A Summer Fairy",
    eyebrow: "Shells, sequins, crochet",
    align: "center",
    cta: "Shop Now",
    limit: 4,
  },
];

/** The two left-aligned blocks that close the page. */
export const FEATURED_BOTTOM: FeaturedCollection[] = [
  {
    handle: "haze-tees",
    heading: "New Arrivals",
    eyebrow: "Campus fits, hoodies, boxy tees, waffle tees, and denim.",
    align: "left",
    cta: "Shop All",
    limit: 4,
  },
  {
    handle: "hoodies-2026",
    heading: "Best Sellers",
    body: "Hoodies when the weather is colder than your ex.",
    align: "left",
    cta: "Shop Now",
    limit: 4,
  },
];

/* -------------------------------------------------------------------------- */
/* Home page — the shoppable reel                                              */
/* -------------------------------------------------------------------------- */

export interface ReelCard {
  /**
   * Product handle. Title and price are read from Supabase so the card can
   * never quote a price the product page disagrees with.
   */
  handle: string;
  /**
   * The customer clip or photo. Falls back to the product's own shot when the
   * user-generated media has not been uploaded yet.
   */
  media?: string;
  /** Set when `media` is a video file rather than a still. */
  video?: boolean;
  /** Overrides the product title, for cards that are a credit rather than a buy. */
  caption?: string;
}

export const REEL = {
  eyebrow: "Fogstores × Summer Sands",
  heading: "pieces seen on you",
  /**
   * Customer posts, each tagged to the piece being worn. The media lives in
   * `public/fogstores/reel/`; a card whose file is missing shows the product's
   * own photography instead, so the row never breaks while clips are being
   * re-cut.
   */
  cards: [
    { handle: "laxmi-top" },
    { handle: "sea-shell-skirt" },
    { handle: "96-tour-100-cotton-tank" },
    { handle: "hailey-black-belt-skirt" },
    { handle: "aqua-blue-sea-shell-skirt" },
    { handle: "shell-skirt" },
  ] as ReelCard[],
};

/* -------------------------------------------------------------------------- */
/* Home page — the Haze Studios break                                          */
/* -------------------------------------------------------------------------- */

/** The orange ticker that separates the two halves of the page. */
export const BRAND_MARQUEE = {
  word: "Haze",
  href: "/collections/haze-studios",
};
