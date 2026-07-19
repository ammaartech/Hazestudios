import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/admin/coming-soon";

const PLACEHOLDERS: Record<string, { title: string; phase: string; description: string }> = {
  payments: {
    title: "Payments",
    phase: "Phase S (Storefront)",
    description:
      "Stripe and other payment gateways are wired up together with the customer checkout.",
  },
  checkout: {
    title: "Checkout",
    phase: "Phase S (Storefront)",
    description:
      "Checkout layout, form fields, and privacy options arrive with the storefront checkout.",
  },
  shipping: {
    title: "Shipping and delivery",
    phase: "Phase S (Storefront)",
    description:
      "Flat rates, carrier-calculated fees, and local pickup are configured once the storefront ships orders.",
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
