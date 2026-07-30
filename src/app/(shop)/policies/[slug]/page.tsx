import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";
import { PageProse, PageShell } from "@/components/shop/page-prose";
import { createPublicClient } from "@/lib/supabase/public";
import { SETTINGS_TAG } from "@/lib/shop/cache";
import {
  POLICY_SETTING_KEY,
  getPolicyPage,
  type PageBlock,
  type PolicySlug,
} from "@/lib/shop/store-pages";

/** The policy slugs are a fixed set in code, so all of them are prerendered. */
export function generateStaticParams() {
  return Object.keys(POLICY_SETTING_KEY).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const policy = getPolicyPage(slug);
  return policy ? { title: policy.title } : { title: "Policy not found" };
}

/**
 * Text typed into the admin arrives as one blob. Blank lines separate
 * paragraphs; a short line immediately followed by more text reads as a
 * heading, which is how these policies are actually written.
 */
function blocksFromText(text: string): PageBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [first, ...rest] = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
      const isHeading = rest.length > 0 && first.length <= 60 && !/[.!?]$/.test(first);

      return isHeading
        ? { heading: first, body: rest }
        : { body: [first, ...rest] };
    });
}

/**
 * Reads the admin-authored policy, falling back to the copy shipped in
 * `store-pages.ts`.
 *
 * The fallback is what keeps these links alive: `shop_settings` may be
 * unreachable (no environment configured yet) or its `policies` blob may simply
 * be empty on a fresh install, and a legal page that 404s is worse than one
 * showing the default text.
 */
async function resolveBlocks(slug: PolicySlug, fallback: PageBlock[]): Promise<PageBlock[]> {
  // Public text, identical for every reader, and legally the least volatile
  // content on the site — so it is cached and prerendered rather than read per
  // request. Tagged with the settings tag, so editing a policy in the admin
  // publishes it immediately rather than at the end of the revalidate window.
  "use cache";
  cacheLife("catalog");
  cacheTag(SETTINGS_TAG);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fallback;

  try {
    // The cookie-blind client, not the session one: a `use cache` scope may not
    // touch request APIs, and a policy page has no reason to know who is asking.
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("shop_settings")
      .select("policies")
      .eq("id", 1)
      .single();

    const authored = (data?.policies as Record<string, string> | null)?.[
      POLICY_SETTING_KEY[slug]
    ];

    return authored?.trim() ? blocksFromText(authored) : fallback;
  } catch {
    return fallback;
  }
}

export default async function PolicyPageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const policy = getPolicyPage(slug);
  if (!policy) notFound();

  const blocks = await resolveBlocks(slug as PolicySlug, policy.blocks);

  return (
    <PageShell title={policy.title}>
      <PageProse blocks={blocks} />
    </PageShell>
  );
}
