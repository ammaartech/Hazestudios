/**
 * Editorial content for the storefront chrome and home page.
 *
 * Everything a merchandiser types — menu labels, campaign copy, artwork — lives
 * here. Everything a merchandiser *sells* comes out of Supabase: the carousels
 * below name collection handles, and the page resolves them at request time.
 * Nothing in this file hardcodes a product.
 *
 * Artwork is served from `public/haze/`, converted to WebP. Swap a file in place
 * to re-shoot a section; no component needs to change.
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
  { icon: "package", text: "Returns extended to 7 days" },
  { icon: "gem", text: "25,000+ customers" },
  { icon: "heart", text: "5% off on prepaid orders" },
];

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

export interface NavLink {
  label: string;
  /** Collection handle, resolved to `/collections/<handle>`. */
  handle: string;
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
      { label: "Mini-Skirts", handle: "fall-2025" },
      { label: "Siren Muse", handle: "siren-muse" },
      { label: "Baby Tees", handle: "babytees" },
      { label: "Tops", handle: "tops" },
    ],
  },
  {
    label: "Men",
    children: [
      { label: "Haze Studios", handle: "haze-studios" },
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

/** Utility links in the search panel and the footer's second column. */
export const QUICK_LINKS = [
  { label: "Sign In", href: "/account/login" },
  { label: "Exchange & Shop Credit", href: "/account/help" },
  { label: "Shipping Policy", href: "/pages/shipping-policy" },
  { label: "Cash On Delivery Policy", href: "/pages/cash-on-delivery-policy" },
  { label: "Terms of Service", href: "/pages/terms-of-service" },
  { label: "Privacy Policy", href: "/pages/privacy-policy" },
];

export const FOOTER_LINKS = [
  { label: "Home", href: "/" },
  { label: "About Us", href: "/pages/about" },
];

export const BRAND_INSTAGRAMS = [
  { handle: "@fogstores.co", href: "https://instagram.com/fogstores.co" },
  { handle: "@hazestudio.in", href: "https://instagram.com/hazestudio.in" },
  { handle: "@summersands.co", href: "https://instagram.com/summersands.co" },
];

export const NEWSLETTER = {
  heading: "Sign up to get 10%",
  body: "Stay up to date with the new collections, products and exclusive offers on our next drop.",
};

/* -------------------------------------------------------------------------- */
/* Home page sections                                                          */
/* -------------------------------------------------------------------------- */

export const HERO = {
  eyebrow: "Fogstores",
  heading: "Haze Studios",
  body: "Feels expensive. Looks good. Priced Fair.",
  cta: { label: "Campus Drip", handle: "haze-studios" },
  /** Two crops: the desktop banner is wide, the mobile one is square. */
  image: "/haze/hero-desktop.webp",
  imageMobile: "/haze/hero-mobile.webp",
};

export interface CarouselSection {
  /** Falls back to the collection's own title when omitted. */
  heading?: string;
  subheading?: string;
  handle: string;
  /** Renders the trailing "Shop Now" link under the carousel. */
  cta?: string;
}

/**
 * The tabbed carousel. Each tab is one collection; the tab label defaults to
 * that collection's title, so renaming a collection in the admin renames the
 * tab. Tabs whose collection is missing are dropped.
 */
export const TAB_CAROUSEL = {
  heading: "Best Sellers",
  subheading: "Our favorite picks for the season",
  tabs: [
    { handle: "ss26-drop-01", label: "Tees" },
    { handle: "knitwear", label: "Hoodies" },
  ] as { handle: string; label?: string }[],
};

export const LOOKBOOK = {
  heading: "Hoodies trending currently",
  /**
   * Four frames. The two that name a handle get a glass "shop the …" button
   * over the image; the other two are pure styling shots.
   */
  frames: [
    { image: "/haze/look-1.webp", alt: "Arctic Monkeys hoodie styled with wide-leg denim" },
    {
      image: "/haze/look-2.webp",
      alt: "Model wearing the Arctic Monkeys hoodie",
      cta: "Shop the look",
      handle: "arctic-monkey",
    },
    {
      image: "/haze/look-3.webp",
      alt: "Model wearing the Cold Culture hoodie",
      cta: "Shop the set",
      handle: "cold-culture",
    },
    { image: "/haze/look-4.webp", alt: "Cold Culture hoodie styled with light denim" },
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
      image: "/haze/arrival-1.webp",
      alt: "Haze Grunge Linen Shirt worn open over a tee",
      thumb: "/haze/arrival-1-thumb.webp",
      handle: "haze-grunge-linen-shirt",
      align: "left" as const,
    },
    {
      image: "/haze/arrival-2.webp",
      alt: "Bodak Tee in washed purple",
      thumb: "/haze/arrival-2-thumb.webp",
      handle: "bodak-tee-1",
      align: "right" as const,
    },
  ],
};

/** The two plain carousels below the arrivals grid. */
export const CAROUSELS: CarouselSection[] = [
  { handle: "outerwear", heading: "Best Sellers" },
  { handle: "archive", heading: "Street Wear Jackets", cta: "Shop Now" },
];

export interface MosaicTile {
  eyebrow: string;
  heading: string;
  body: string;
  cta: string;
  handle: string;
  image: string;
  alt: string;
}

export const MOSAIC: MosaicTile[] = [
  {
    eyebrow: "Be dripped out",
    heading: "Accessories",
    body: "Beanies, Belt, Rings",
    cta: "Shop Now",
    handle: "mens-accessories",
    image: "/haze/tile-accessories.webp",
    alt: "Spider-web knit beanie",
  },
  {
    eyebrow: "Personalize",
    heading: "Couple Tees",
    body: "Customized Slogans, Pictures etc",
    cta: "Shop Now",
    handle: "haze-v-26-copy",
    image: "/haze/tile-couple-tees.webp",
    alt: "Two people in matching playing-card tees",
  },
  {
    eyebrow: "Last chance",
    heading: "Clearance",
    body: "Deals available FRI–MON only.",
    cta: "Shop Saving",
    handle: "limited-offers",
    image: "/haze/tile-clearance.webp",
    alt: "West Coast cross-print tee, back view",
  },
];
