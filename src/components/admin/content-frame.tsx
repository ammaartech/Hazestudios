"use client";

import { usePathname } from "next/navigation";

const lists = new Set([
  "/admin/orders", "/admin/orders/drafts", "/admin/orders/abandoned",
  "/admin/products", "/admin/products/collections", "/admin/products/inventory",
  "/admin/products/gift-cards", "/admin/customers", "/admin/customers/segments",
  "/admin/discounts", "/admin/content/files", "/admin/waitlist",
]);

/** Route state must not depend on retained, hidden Next.js Activity children. */
export function AdminContentFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const mode = path === "/admin" || path.startsWith("/admin/analytics")
    ? "dashboard"
    : /^\/admin\/orders\/[0-9a-f-]{36}$/.test(path)
      ? "order"
      : lists.has(path) || path.startsWith("/admin/orders/tracking")
        ? "list"
        : "editor";
  return <div className="admin-content-frame" data-layout={mode}>{children}</div>;
}
