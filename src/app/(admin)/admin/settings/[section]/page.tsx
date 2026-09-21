import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/admin/coming-soon";

// 'payments' and 'shipping' are no longer here: both are real pages now (the
// Cashfree integration; the courier integrations in 0034), and a static route
// wins over this dynamic one anyway — leaving an entry would only mean a
// placeholder nothing can reach.
const PLACEHOLDERS: Record<string, { title: string; phase: string; description: string }> = {
  checkout: {
    title: "Checkout",
    phase: "Phase S (Storefront)",
    description:
      "Checkout layout, form fields, and privacy options arrive with the storefront checkout.",
  },
  taxes: {
    title: "Taxes and duties",
    phase: "Phase S (Storefront)",
    description:
      "Regional tax collection and international duties automate alongside checkout.",
  },
  markets: {
    title: "Markets",
    phase: "Phase 3",
    description:
      "Localized currencies, languages, and pricing per international region.",
  },
  domains: {
    title: "Domains",
    phase: "Phase 4",
    description: "Buy new domains or connect existing custom domains.",
  },
  notifications: {
    title: "Notifications",
    phase: "Phase 3",
    description:
      "Customize automated email and SMS templates sent to customers.",
  },
  "customer-events": {
    title: "Customer events",
    phase: "Phase 3",
    description:
      "Install custom tracking pixels like Google Analytics or Meta Pixel.",
  },
  languages: {
    title: "Languages",
    phase: "Phase 3",
    description: "Translate your store content into multiple languages.",
  },
  "custom-data": {
    title: "Custom data",
    phase: "Phase 3",
    description:
      "Add custom metafields to products, orders, or customers.",
  },
  apps: {
    title: "Apps and sales channels",
    phase: "Phase 4",
    description: "Install and configure app extensions and sales channels.",
  },
  billing: {
    title: "Plan and billing",
    phase: "Phase 4",
    description: "Manage subscription tier, invoices, and payouts.",
  },
};

export default async function SettingsPlaceholderPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const entry = PLACEHOLDERS[section];
  if (!entry) notFound();

  return (
    <ComingSoon
      title={entry.title}
      phase={entry.phase}
      description={entry.description}
    />
  );
}
