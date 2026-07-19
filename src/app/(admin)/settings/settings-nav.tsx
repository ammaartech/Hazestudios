"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECTIONS: { label: string; href: string; placeholder?: boolean }[] = [
  { label: "Store details", href: "/settings/general" },
  { label: "Users and permissions", href: "/settings/users" },
  { label: "Locations", href: "/settings/locations" },
  { label: "Brand", href: "/settings/brand" },
  { label: "Policies", href: "/settings/policies" },
  { label: "Payments", href: "/settings/payments", placeholder: true },
  { label: "Checkout", href: "/settings/checkout", placeholder: true },
  { label: "Shipping and delivery", href: "/settings/shipping", placeholder: true },
  { label: "Taxes and duties", href: "/settings/taxes", placeholder: true },
  { label: "Markets", href: "/settings/markets", placeholder: true },
  { label: "Domains", href: "/settings/domains", placeholder: true },
  { label: "Notifications", href: "/settings/notifications", placeholder: true },
  { label: "Customer events", href: "/settings/customer-events", placeholder: true },
  { label: "Languages", href: "/settings/languages", placeholder: true },
  { label: "Custom data", href: "/settings/custom-data", placeholder: true },
  { label: "Apps and sales channels", href: "/settings/apps", placeholder: true },
  { label: "Plan and billing", href: "/settings/billing", placeholder: true },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="space-y-0.5">
      <p className="px-2.5 pb-2 text-sm font-semibold">Settings</p>
      {SECTIONS.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className={cn(
            "block rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
            pathname === s.href
              ? "bg-accent font-semibold text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          )}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
