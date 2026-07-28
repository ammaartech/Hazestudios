import Image from "next/image";
import Link from "next/link";
import {
  BRAND_MARQUEE,
  EDITORIAL_BANNER,
  HERO,
  SHOP_THE_LOOK,
  SHORTCUTS,
  type HeroContent,
} from "@/lib/shop/home-content";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Shortcut row                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The two square shortcuts above the campaign banner. Hairline outlines rather
 * than filled buttons: they sit directly under the navigation, and two solid
 * blocks there would read as the page's primary action before the shopper has
 * seen a single garment.
 */
export function ShortcutRow() {
  return (
    <nav aria-label="Shortcuts" className="border-b border-[var(--shop-hairline-soft)]">
      <ul className="flex items-stretch justify-center gap-3 px-4 py-3 md:gap-4">
        {SHORTCUTS.map((item) => (
          <li key={item.href} className="flex-1 md:max-w-56">
            <Link
              href={item.href}
              className="meta flex min-h-11 cursor-pointer items-center justify-center border border-[var(--shop-hairline)] px-6 text-[var(--shop-ink)] transition-colors duration-300 hover:border-[var(--shop-ink)] hover:bg-[var(--shop-ink)] hover:text-[var(--shop-canvas)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-ink)]"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The campaign banner.
 *
 * Two crops rather than one: the desktop banner is a 2.5:1 letterbox and the
 * mobile one is square. Cropping the wide shot down to a phone would either
 * lose the subject or shrink it to nothing, so the art direction is switched at
 * the breakpoint by `<picture>` and the browser only ever downloads one.
 *
 * `overlay` follows the theme's per-slide setting. Without it the photograph
 * carries the type on its own composition and a soft text shadow supplies the
 * contrast floor; with it a wash is laid over the image, for banners whose
 * subject sits where the words do.
 */
export function Hero({
  content = HERO,
  overlay = false,
  caps = false,
}: {
  content?: HeroContent;
  overlay?: boolean;
  /** Art direction, per banner: the campaign lockups differ in case. */
  caps?: boolean;
}) {
  return (
    <section className="relative isolate bg-[var(--shop-cloud)]">
      <picture>
        <source media="(min-width: 768px)" srcSet={content.image} />
        <img
          src={content.imageMobile}
          alt=""
          aria-hidden
          fetchPriority="high"
          /* The desktop crop is a fixed 2.5:1, which on an ultrawide monitor
             resolves to a banner taller than the screen — the shopper lands on
             a full page of photograph with the first product below the fold.
             Capping the height lets the ratio hold on a laptop and quietly
             give way on anything wider. */
          className="aspect-square w-full object-cover md:aspect-[2.5/1] md:max-h-[78dvh]"
        />
      </picture>

      {overlay && <div className="absolute inset-0 bg-black/30" aria-hidden />}

      <div className="absolute inset-0 grid place-items-center px-6 text-center">
        <div style={{ textShadow: "0 1px 18px rgba(0,0,0,0.45)" }}>
          <p className="subheading text-white">{content.eyebrow}</p>
          <h1
            className={cn(
              "display display-xl mt-3 text-[clamp(2.25rem,6vw,4.25rem)] text-white",
              caps && "uppercase"
            )}
          >
            {content.heading}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-white md:text-base">
            {content.body}
          </p>
          <Link
            href={content.cta.href}
            className="meta mt-7 inline-flex min-h-11 cursor-pointer items-center bg-[var(--shop-ink)] px-8 text-white transition-opacity duration-300 hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            style={{ textShadow: "none" }}
          >
            {content.cta.label}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section headings                                                            */
/* -------------------------------------------------------------------------- */

/** The Space Mono caps label that introduces an editorial block. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("subheading text-[var(--shop-ink)]", className)}>
      {children}
    </p>
  );
}

/**
 * A centred eyebrow, optionally with a heading under it. Used on its own as a
 * divider between blocks, and with a heading to open one.
 */
export function SectionIntro({
  eyebrow,
  heading,
  className,
}: {
  eyebrow: string;
  heading?: string;
  className?: string;
}) {
  return (
    <div className={cn("px-4 pb-2 pt-14 text-center md:px-8 md:pt-20", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      {heading && (
        <h2 className="display mt-2.5 text-[clamp(1.5rem,3.5vw,2.25rem)]">
          {heading}
        </h2>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shop the look                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Four shoppable styling frames.
 *
 * The button is an outline over photography rather than a solid chip: at four
 * across, four filled blocks would compete with the garments they are pointing
 * at. On a phone the row becomes a scroll rail — four columns at that width
 * would render each look about eighty pixels wide.
 */
export function ShopTheLook() {
  return (
    <section aria-label="Shop the look" className="pt-4">
      <div className="rail auto-cols-[74%] gap-2 px-4 sm:auto-cols-[42%] md:grid md:auto-cols-auto md:grid-cols-4 md:overflow-visible md:px-2">
        {SHOP_THE_LOOK.map((frame, i) => (
          <figure key={frame.image} className="relative isolate">
            <Image
              src={frame.image}
              alt={frame.alt}
              width={1000}
              height={1430}
              priority={i < 2}
              sizes="(max-width: 640px) 74vw, (max-width: 768px) 42vw, 25vw"
              className="aspect-[7/10] w-full object-cover"
            />
            <Link
              href={`/products/${frame.handle}`}
              className="glass-press absolute inset-x-5 bottom-5 flex min-h-11 cursor-pointer items-center justify-center rounded-[4px] border border-white/90 text-[0.8125rem] text-white backdrop-blur-[2px] transition-colors duration-300 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white md:inset-x-7"
            >
              {frame.cta}
            </Link>
          </figure>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Brand marquee                                                               */
/* -------------------------------------------------------------------------- */

function Star() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-[1.1em] shrink-0"
      aria-hidden
    >
      <path d="M12 1.5l2.35 6.9 7.15.16-5.7 4.36 2.05 7-5.85-4.1-5.85 4.1 2.05-7-5.7-4.36 7.15-.16z" />
    </svg>
  );
}

/**
 * The orange ticker that hands the page over from Fogstores to Haze Studios.
 *
 * One word repeated is a graphic device, not a message, so the whole strip is
 * announced once as a link to the collection and the repetition is hidden from
 * assistive tech.
 */
export function BrandMarquee() {
  const repeats = Array.from({ length: 16 }, (_, i) => i);

  return (
    <Link
      href={BRAND_MARQUEE.href}
      aria-label={`Shop ${BRAND_MARQUEE.word} Studios`}
      className="mt-14 block cursor-pointer bg-[#fc5432] py-3.5 text-white md:mt-20"
    >
      <div
        className="marquee"
        aria-hidden
        style={{
          ["--marquee-gap" as string]: "1.5rem",
          ["--marquee-duration" as string]: "26s",
        }}
      >
        {[0, 1].map((track) => (
          <div className="marquee__track" key={track}>
            {repeats.map((i) => (
              <span
                key={i}
                className="flex items-center gap-3 whitespace-nowrap text-lg font-semibold uppercase tracking-[0.03em] md:text-xl"
              >
<<<<<<< HEAD
                <Star />
                {BRAND_MARQUEE.word}
              </span>
            ))}
=======
                <Image
                  src={frame.thumb}
                  alt=""
                  width={120}
                  height={150}
                  className="aspect-[4/5] w-12 shrink-0 rounded-[3px] object-cover"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[0.6875rem] font-semibold leading-tight text-[var(--shop-ink)]">
                    {tag.title}
                  </span>
                  <Price
                    amount={tag.price}
                    compareAt={tag.compareAt}
                    className="mt-1 text-[0.6875rem] text-[var(--shop-charcoal)]"
                  />
                </span>
              </Link>
            )}
          </figure>
        );
      })}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Mosaic                                                                      */
/* -------------------------------------------------------------------------- */

/** Three editorial doors into the catalogue, closing the page above the footer. */
export function Mosaic() {
  return (
    <section className="mt-20 grid gap-2 px-2 md:mt-28 md:grid-cols-3">
      <h2 className="sr-only">Shop by category</h2>
      {MOSAIC.map((tile) => (
        <Link
          key={tile.handle}
          href={`/collections/${tile.handle}`}
          /* Three tiles stack on a phone, so a height tuned for one column on a
             desktop turns into three screens of scrolling on a handset. */
          className="group relative isolate flex min-h-[20rem] items-center justify-center overflow-hidden bg-[var(--shop-cloud)] p-8 text-center focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white sm:min-h-[24rem] md:min-h-[26rem] lg:min-h-[32rem]"
        >
          <Image
            src={tile.image}
            alt={tile.alt}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-black/35" aria-hidden />

          <div className="relative">
            <p className="meta text-white/80">{tile.eyebrow}</p>
            <h3 className="display mt-3 text-[clamp(2rem,4vw,3rem)] text-white">
              {tile.heading}
            </h3>
            <p className="mt-3 text-sm text-white/85">{tile.body}</p>
            <span className="meta mt-5 inline-block border-b border-white/70 pb-1 text-white transition-colors duration-300 group-hover:border-white">
              {tile.cta}
            </span>
>>>>>>> e42a8b0 (ui updates, refering suha demo, inputting produts, inputting invectory, fixed instagram link)
          </div>
        ))}
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Editorial banner                                                            */
/* -------------------------------------------------------------------------- */

/** The full-bleed campaign image that closes the Haze Studios break. */
export function EditorialBanner() {
  return (
    <section aria-labelledby="editorial-banner">
      <div className="px-4 pb-8 pt-14 text-center md:px-8 md:pt-20">
        <Eyebrow>{EDITORIAL_BANNER.eyebrow}</Eyebrow>
        <h2
          id="editorial-banner"
          className="display mt-2.5 text-[clamp(1.5rem,3.5vw,2.25rem)] uppercase"
        >
          {EDITORIAL_BANNER.heading}
        </h2>
      </div>

      <Link href={EDITORIAL_BANNER.href} className="block cursor-pointer">
        <Image
          src={EDITORIAL_BANNER.image}
          alt={EDITORIAL_BANNER.alt}
          width={2000}
          height={800}
          sizes="100vw"
          className="aspect-[2/1] w-full object-cover md:aspect-[2.5/1]"
        />
      </Link>
    </section>
  );
}
