/**
 * Editorial content for the Haze Studios landing page at
 * `/collections/haze-studios` — the menswear side of Fogstores.
 *
 * Mirrors the Shopify theme's `page.men` template section-for-section. As with
 * the home page, everything authored lives here and everything sold is resolved
 * from Supabase at request time: the blocks below name collection and product
 * handles, never titles or prices.
 *
 * Artwork is served from `public/fogstores/men/`.
 */

import type { FeaturedCollection, HeroContent } from "./home-content";

/* -------------------------------------------------------------------------- */
/* The campaign banner                                                         */
/* -------------------------------------------------------------------------- */

export const HAZE_HERO: HeroContent = {
  eyebrow: "Fogstores",
  heading: "Haze Studios",
  body: "Feels expensive. Looks good. Priced Fair.",
  cta: { label: "Campus Drip", href: "/collections/haze-tees" },
  image: "/fogstores/men/hero-desktop.png",
  imageMobile: "/fogstores/men/hero-mobile.png",
};

/* -------------------------------------------------------------------------- */
/* The tabbed best-sellers rail                                                */
/* -------------------------------------------------------------------------- */

/**
 * Two collections behind one heading. The tab label defaults to the
 * collection's own title, so renaming a collection in the admin renames the
 * tab; a tab whose collection is missing is dropped.
 */
export const HAZE_TABS = {
  heading: "Best Sellers",
  subheading: "Our favorite picks for the season",
  limit: 12,
  tabs: [
    { handle: "haze-tees", label: "Tees" },
    { handle: "haze-hoodies", label: "Hoodies" },
  ] as { handle: string; label?: string }[],
};

/* -------------------------------------------------------------------------- */
/* The lookbook                                                                */
/* -------------------------------------------------------------------------- */

export interface LookbookFrame {
  image: string;
  alt: string;
  handle: string;
  cta: string;
}

/**
 * Four frames, read as two pairs: a flat-lay styling board next to the piece
 * being worn. Each board points at the hoodie it is built around, so all four
 * frames are shoppable rather than two being decoration.
 */
export const HAZE_LOOKBOOK = {
  eyebrow: "Hoodies trending currently",
  frames: [
    {
      image: "/fogstores/men/look-1.png",
      alt: "Flat-lay: black Arctic Monkeys hoodie with washed black wide-leg denim, Air Force 1s and a CD player",
      handle: "arctic-monkey",
      cta: "Shop the look",
    },
    {
      image: "/fogstores/men/look-2.png",
      alt: "Navy Arctic Monkeys hoodie worn with ripped straight denim in a café",
      handle: "arctic-monkey",
      cta: "Shop the look",
    },
    {
      image: "/fogstores/men/look-3.png",
      alt: "Blue Cold Culture hoodie worn back-to-camera, showing the star back print",
      handle: "cold-culture",
      cta: "Shop the set",
    },
    {
      image: "/fogstores/men/look-4.png",
      alt: "Flat-lay: blue Cold Culture hoodie with a white tee, light denim, cap and Air Force 1s",
      handle: "cold-culture",
      cta: "Shop the look",
    },
  ] as LookbookFrame[],
};

/* -------------------------------------------------------------------------- */
/* The two-column arrivals banner                                              */
/* -------------------------------------------------------------------------- */

export interface ArrivalFrame {
  image: string;
  alt: string;
  /** The product tagged in the card pinned over the image. */
  handle: string;
  /** Which bottom corner the card sits in. */
  align: "left" | "right";
}

export const HAZE_ARRIVALS = {
  eyebrow: "New arrivals",
  frames: [
    {
      image: "/fogstores/men/arrival-left.png",
      alt: "Haze Grunge Linen Shirt worn open over a tee",
      handle: "haze-grunge-linen-shirt",
      align: "left",
    },
    {
      image: "/fogstores/men/arrival-right.png",
      alt: "Bodak Tee styled for the new season",
      handle: "bodak-tee-1",
      align: "right",
    },
  ] as ArrivalFrame[],
};

/* -------------------------------------------------------------------------- */
/* The merchandised collection blocks                                          */
/* -------------------------------------------------------------------------- */

export const HAZE_FEATURED: FeaturedCollection[] = [
  {
    handle: "men",
    heading: "Best Sellers",
    align: "center",
    cta: "Shop Now",
    limit: 4,
  },
  {
    handle: "jackets",
    heading: "Street Wear Jackets",
    align: "left",
    cta: "Shop Now",
    limit: 4,
  },
];

/* -------------------------------------------------------------------------- */
/* The closing tiles                                                           */
/* -------------------------------------------------------------------------- */

export interface Tile {
  eyebrow: string;
  heading: string;
  body: string;
  cta: string;
  href: string;
  image: string;
  alt: string;
}

/** Three editorial doors into the catalogue, closing the page above the footer. */
export const HAZE_TILES: Tile[] = [
  {
    eyebrow: "Be dripped out",
    heading: "Accessories",
    body: "Beanies, Belt, Rings",
    cta: "Shop Now",
    href: "/collections/mens-accessories",
    image: "/fogstores/men/tile-accessories.png",
    alt: "Knitted beanie and silver rings",
  },
  {
    eyebrow: "Personalize",
    heading: "Couple Tees",
    body: "Customized Slogans, Pictures etc",
    cta: "Shop Now",
    href: "/collections/haze-v-26-copy",
    image: "/fogstores/men/tile-couple-tees.jpg",
    alt: "Two people in matching printed tees",
  },
  {
    eyebrow: "Last chance",
    heading: "Clearance",
    body: "Deals available FRI–MON only.",
    cta: "Shop Saving",
    href: "/collections/limited-offers",
    image: "/fogstores/men/tile-clearance.png",
    alt: "Graphic tee, back view",
  },
];
