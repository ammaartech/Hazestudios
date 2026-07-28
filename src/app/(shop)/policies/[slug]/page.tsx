import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageProse, PageShell } from "@/components/shop/page-prose";
import { createClient } from "@/lib/supabase/server";
import {
  POLICY_SETTING_KEY,
  getPolicyPage,
  type PageBlock,
  type PolicySlug,
} from "@/lib/shop/store-pages";

export const dynamic = "force-dynamic";

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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fallback;

  try {
    const supabase = await createClient();
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
