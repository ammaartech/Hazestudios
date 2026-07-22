"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECTIONS: { label: string; href: string; placeholder?: boolean }[] = [
  { label: "Store details", href: "/admin/settings/general" },
  { label: "Users and permissions", href: "/admin/settings/users" },
  { label: "Locations", href: "/admin/settings/locations" },
  { label: "Brand", href: "/admin/settings/brand" },
  { label: "Policies", href: "/admin/settings/policies" },
  { label: "Payments", href: "/admin/settings/payments", placeholder: true },
  { label: "Checkout", href: "/admin/settings/checkout", placeholder: true },
  { label: "Shipping and delivery", href: "/admin/settings/shipping", placeholder: true },
  { label: "Taxes and duties", href: "/admin/settings/taxes", placeholder: true },
  { label: "Markets", href: "/admin/settings/markets", placeholder: true },
  { label: "Domains", href: "/admin/settings/domains", placeholder: true },
  { label: "Notifications", href: "/admin/settings/notifications", placeholder: true },
  { label: "Customer events", href: "/admin/settings/customer-events", placeholder: true },
  { label: "Languages", href: "/admin/settings/languages", placeholder: true },
  { label: "Custom data", href: "/admin/settings/custom-data", placeholder: true },
  { label: "Apps and sales channels", href: "/admin/settings/apps", placeholder: true },
  { label: "Plan and billing", href: "/admin/settings/billing", placeholder: true },
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
