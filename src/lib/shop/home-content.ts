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
<<<<<<< HEAD
      { label: "Haze Studios", handle: "haze-studios", page: true },
=======
      // `hazestudios`, not `haze-studios` — the hyphenated handle 404s.
      { label: "Haze Studios", handle: "hazestudios" },
>>>>>>> e42a8b0 (ui updates, refering suha demo, inputting produts, inputting invectory, fixed instagram link)
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

<<<<<<< HEAD
=======
/**
 * Campaign artwork is referenced straight off the Shopify CDN rather than
 * copied into `public/`. The catalogue behind this storefront was imported from
 * a Shopify export, so every product already renders from that origin (see the
 * `cdn.shopify.com` entry in `next.config.ts`) — pointing the editorial frames
 * at the same place keeps the home page and the product pages showing the same
 * photography, and re-shooting a section is a URL change rather than a binary.
 *
 * `&width=` is Shopify's own transform, so each frame pulls a crop sized for
 * its slot instead of a full-resolution original.
 */
const CDN = "https://cdn.shopify.com/s/files/1/0633/6105/6992/files";

export const HERO = {
  eyebrow: "Fogstores",
  heading: "Siren Muse",
  body: "Mini-skirts, boots and studs. The edit everyone is asking about.",
  cta: { label: "Shop Siren Muse", handle: "fall-2025" },
  /** Two crops: the desktop banner is wide, the mobile one is square. */
  image: `${CDN}/Saumya_Tank_and_Hailey_Skirt_10.jpg?v=1760198387&width=2000`,
  imageMobile: `${CDN}/Saumya_Tank_and_Hailey_Skirt_10.jpg?v=1760198387&width=900`,
};

export interface CarouselSection {
  /** Falls back to the collection's own title when omitted. */
  heading?: string;
  subheading?: string;
  handle: string;
  /** Renders the trailing "Shop Now" link under the carousel. */
  cta?: string;
}

>>>>>>> e42a8b0 (ui updates, refering suha demo, inputting produts, inputting invectory, fixed instagram link)
/**
 * The two square shortcuts that sit between the header and the campaign banner.
 * Deliberately short: this row is a shortcut to the two highest-intent
 * destinations, not a second navigation.
 */
<<<<<<< HEAD
export const SHORTCUTS = [
  { label: "Sale", href: "/collections/limited-offers" },
  { label: "Men", href: "/collections/haze-studios" },
=======
export const TAB_CAROUSEL = {
  heading: "Shop by category",
  subheading: "Our favorite picks for the season",
  tabs: [
    { handle: "tops", label: "Tops" },
    { handle: "best-sellers", label: "Best Sellers" },
    { handle: "bottoms", label: "Bottoms" },
    { handle: "fall-2024", label: "Fall 2024" },
  ] as { handle: string; label?: string }[],
};

export const LOOKBOOK = {
  heading: "Most trending",
  /**
   * Four frames. The two that name a handle get a glass "shop the …" button
   * over the image; the other two are pure styling shots.
   */
  frames: [
    {
      image: `${CDN}/Hazel_Top_and_Hailey_Skirt_8_35a1312b-61bf-4edc-aea2-c551b5968e05.jpg?v=1760198467&width=1000`,
      alt: "Hazel top styled with the Hailey black belt skirt",
    },
    {
      image: `${CDN}/Saumya_Tank_and_Hailey_Skirt_10.jpg?v=1760198387&width=1000`,
      alt: "Model wearing the I'm Out Of My Mind yellow tank top",
      cta: "Shop the look",
      handle: "i-m-out-of-my-mind-yellow-tank-top",
    },
    {
      image: `${CDN}/1a3fb29549b078036e154365f8c7a7ee.jpg?v=1769864605&width=1000`,
      alt: "Model wearing the beaded Midnight top",
      cta: "Shop the set",
      handle: "beaded-ibiza-top",
    },
    {
      image: `${CDN}/JenaStudBoots.jpg?v=1760377847&width=1000`,
      alt: "Jena stud boots",
    },
  ],
};

export const ARRIVALS = {
  heading: "New arrivals",
  /**
   * Two full-bleed frames, each with a product tag pinned to a bottom corner.
   * The tag's price is read from Supabase — only the handle is authored here.
   */
  frames: [
    {
      image: `${CDN}/417947355_1280176176008672_8716161203192785911_n.jpg?v=1709802872&width=1600`,
      alt: "Annie black corset dress",
      thumb: `${CDN}/417947355_1280176176008672_8716161203192785911_n.jpg?v=1709802872&width=240`,
      handle: "annie-black-corset-dress",
      align: "left" as const,
    },
    {
      image: `${CDN}/e59fee53-74fd-4e51-8c94-a9afbcb7ea7d.jpg?v=1779866661&width=1600`,
      alt: "Butterfly denim",
      thumb: `${CDN}/e59fee53-74fd-4e51-8c94-a9afbcb7ea7d.jpg?v=1779866661&width=240`,
      // Shopify's handle is `untitled-may27_06-02-41`; the import slugifies the
      // underscore away, and the database's handle is the one that resolves.
      handle: "untitled-may27-06-02-41",
      align: "right" as const,
    },
  ],
};

/** The two plain carousels below the arrivals grid. */
export const CAROUSELS: CarouselSection[] = [
  { handle: "fall-2025", heading: "Festival Edit", cta: "Shop Now" },
  { handle: "shell-and-sequins", heading: "Summer Collection", cta: "Shop Now" },
>>>>>>> e42a8b0 (ui updates, refering suha demo, inputting produts, inputting invectory, fixed instagram link)
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

<<<<<<< HEAD
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
=======
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
    handle: "hazestudios",
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
>>>>>>> e42a8b0 (ui updates, refering suha demo, inputting produts, inputting invectory, fixed instagram link)
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

/** The full-bleed campaign image under it. */
export const EDITORIAL_BANNER = {
  eyebrow: "Fogstores × Haze Studios",
  heading: "Why should girls have all the fun?",
  image: "/fogstores/banner-not-cute.png",
  alt: "Haze Studios outerwear — studded hoodie and graphic hood",
  href: "/collections/haze-studios",
};
