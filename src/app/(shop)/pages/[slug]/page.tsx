import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageProse, PageShell } from "@/components/shop/page-prose";
import { STORE_PAGES, getStorePage } from "@/lib/shop/store-pages";

/** The content pages are static data, so they prerender. */
export function generateStaticParams() {
  return STORE_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getStorePage(slug);
  if (!page) return { title: "Page not found" };

  return {
    title: page.title,
    description: page.description ?? page.blocks[0]?.body?.[0]?.slice(0, 160),
  };
}

export default async function StorePageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = getStorePage(slug);
  if (!page) notFound();

  return (
    <PageShell title={page.title} description={page.description}>
      <PageProse blocks={page.blocks} />
    </PageShell>
  );
}
