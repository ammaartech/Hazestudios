import Image from "next/image";
import Link from "next/link";
import type { ShopProduct } from "@/lib/shop/queries";
import { cn } from "@/lib/utils";
import { Price } from "./price";
import { revealProps } from "./reveal";

/**
 * The photograph is the card — no border, no radius, no shadow. The only chrome
 * is the soft-gray stage the image sits on, per the Nike product-card token.
 */
export function ProductCard({
  product,
  eager = false,
  revealIndex = 0,
  className,
}: {
  product: ShopProduct;
  /**
   * Set on above-the-fold cards so their image isn't lazy-loaded. Deliberately
   * not `fetchPriority="high"`: a grid has several images that could each be
   * the LCP depending on viewport, and marking them all high priority just
   * splits the same bandwidth more ways. Skipping the lazy-load round trip is
   * the win; the ranking is the browser's to make.
   */
  eager?: boolean;
  /**
   * Position in the entrance cascade. Callers pass the column rather than the
   * running index: a grid staggered end to end would leave the last row of a
   * long collection waiting on every card above it.
   */
  revealIndex?: number;
  className?: string;
}) {
  const [primary, secondary] = product.images;
  const soldOut = !product.inStock;

  return (
    <Link
      // Handle, not id: the shareable URL customers see and search engines index.
      href={`/products/${product.handle || product.id}`}
      className={cn(
        "group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--shop-ink)]",
        className
      )}
      {...revealProps("rise", revealIndex)}
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-[var(--shop-cloud)]">
        {primary ? (
          <>
            <Image
              src={primary.url}
              alt={primary.alt || product.title}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              loading={eager ? "eager" : "lazy"}
              className={cn(
                "object-cover transition-opacity duration-300",
                // Cross-fade to the second shot on hover — opacity only, so the
                // card never shifts layout under the cursor.
                secondary && "group-hover:opacity-0",
                soldOut && "opacity-60"
              )}
            />
            {secondary && (
              <Image
                src={secondary.url}
                alt=""
                aria-hidden
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className="object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="meta text-[var(--shop-stone)]">No image</span>
          </div>
        )}

        {/* The badge floats over the photograph, so it belongs to the control
            layer and takes the glass. The card itself stays hard-edged. */}
        {soldOut && (
          <span className="meta glass glass-dark glass-pill absolute left-3 top-3 px-3 py-1.5">
            Sold out
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-[var(--shop-ink)]">
            {product.title}
          </h3>
          {product.product_type && (
            <p className="truncate text-sm text-[var(--shop-mute)]">
              {product.product_type}
            </p>
          )}
        </div>
        <Price
          amount={product.price}
          compareAt={product.compare_at_price}
          className="shrink-0 text-sm"
        />
      </div>
    </Link>
  );
}
