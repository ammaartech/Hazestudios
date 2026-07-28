import type { PageBlock } from "@/lib/shop/store-pages";

/**
 * The reading column shared by `/pages/…` and `/policies/…`.
 *
 * Deliberately narrow: policy copy is long-form and unstyled, and a measure of
 * roughly 70 characters is the difference between something that gets read and
 * something that gets scrolled past.
 */
export function PageProse({ blocks }: { blocks: PageBlock[] }) {
  return (
    <div className="space-y-10">
      {blocks.map((block, i) => (
        <section key={block.heading ?? i}>
          {block.heading && (
            <h2 className="display mb-3 text-[clamp(1.25rem,2.5vw,1.75rem)]">
              {block.heading}
            </h2>
          )}

          {block.body?.map((paragraph) => (
            <p
              key={paragraph}
              className="mt-3 text-base leading-relaxed text-[var(--shop-charcoal)] first:mt-0"
            >
              {paragraph}
            </p>
          ))}

          {block.list && (
            <ul className="mt-4 space-y-2 pl-5">
              {block.list.map((item) => (
                <li
                  key={item}
                  className="list-disc text-base leading-relaxed text-[var(--shop-charcoal)] marker:text-[var(--shop-mute)]"
                >
                  {item}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** Wrapper giving both routes the same masthead and column. */
export function PageShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-[46rem] px-4 pb-24 pt-16 md:px-8 md:pt-24">
      <header className="border-b border-[var(--shop-hairline-soft)] pb-8">
        <h1 className="display text-[clamp(2rem,6vw,3.75rem)]">{title}</h1>
        {description && (
          <p className="mt-4 max-w-lg text-base leading-relaxed text-[var(--shop-mute)]">
            {description}
          </p>
        )}
      </header>

      <div className="pt-10">{children}</div>
    </article>
  );
}
