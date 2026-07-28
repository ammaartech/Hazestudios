import { createClient } from "@/lib/supabase/server";
import { HELP_ARTICLES, HELP_TOPICS } from "@/lib/shop/help-articles";
import { ContactChannels } from "@/components/shop/contact-channels";
import { AccountShell } from "../account-shell";

export const metadata = { title: "Help" };
export const dynamic = "force-dynamic";

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;

  let supportEmail = "hello@fogstores.com";
  let storeName = "Fogstores";
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("shop_settings")
        .select("email, store_name")
        .single();
      if (data?.email) supportEmail = data.email;
      if (data?.store_name) storeName = data.store_name;
    } catch {
      // Fall back to defaults — help content does not depend on settings.
    }
  }

  return (
    <AccountShell
      title="Help"
      description={
        order
          ? `Answers below, or get in touch about order #${order}.`
          : "Answers to the questions we get most, and how to reach us."
      }
      current="/account/help"
    >
      <div className="space-y-10">
        <ContactChannels
          supportEmail={supportEmail}
          storeName={storeName}
          orderNumber={order}
        />

        {HELP_TOPICS.map((topic) => {
          const articles = HELP_ARTICLES.filter((a) => a.topic === topic);
          if (!articles.length) return null;

          return (
            <section key={topic}>
              <h2 className="meta mb-3 text-(--shop-mute)">{topic}</h2>
              <div className="glass glass-on-light glass-panel divide-y divide-(--shop-hairline-soft) overflow-hidden">
                {articles.map((article) => (
                  // <details> rather than JS accordion state: it works before
                  // hydration, is keyboard-operable for free, and is findable
                  // by in-page browser search when collapsed.
                  <details key={article.slug} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 text-[15px] font-medium text-(--shop-ink)">
                      {article.question}
                      <span
                        aria-hidden
                        className="shrink-0 text-(--shop-mute) transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-open:rotate-90"
                      >
                        ›
                      </span>
                    </summary>
                    <p className="px-5 pb-5 text-sm leading-relaxed text-(--shop-charcoal)">
                      {article.answer}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </AccountShell>
  );
}
