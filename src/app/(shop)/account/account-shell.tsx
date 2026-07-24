import Link from "next/link";
import { Package, User, LifeBuoy, LayoutDashboard, LogOut } from "lucide-react";
import { signOut } from "./actions";

const LINKS = [
  { href: "/account", label: "Overview", icon: LayoutDashboard },
  { href: "/account/orders", label: "Orders", icon: Package },
  { href: "/account/profile", label: "Details", icon: User },
  { href: "/account/help", label: "Help", icon: LifeBuoy },
];

/**
 * Chrome for the signed-in account area.
 *
 * The nav is a horizontal scroller on phones and a sidebar from `md` up, rather
 * than a list that collapses into a menu — four destinations do not earn a
 * disclosure, and keeping them visible means one tap instead of two.
 */
export function AccountShell({
  title,
  description,
  current,
  children,
}: {
  title: string;
  description?: string;
  current: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pt-10 md:px-8 md:pt-14">
      <header className="mb-8">
        <h1 className="display text-[clamp(2rem,6vw,3.5rem)]">{title}</h1>
        {description && (
          <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-(--shop-mute)">
            {description}
          </p>
        )}
      </header>

      <div className="grid gap-8 md:grid-cols-[200px_1fr] md:gap-12">
        <nav aria-label="Account" className="md:sticky md:top-24 md:self-start">
          <ul className="-mx-1 flex gap-1 overflow-x-auto pb-2 md:mx-0 md:flex-col md:overflow-visible md:pb-0">
            {LINKS.map((link) => {
              const active = current === link.href;
              const Icon = link.icon;
              return (
                <li key={link.href} className="shrink-0">
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`glass-press flex min-h-11 items-center gap-2.5 rounded-full px-4 text-sm font-medium transition-colors duration-300 md:w-full ${
                      active
                        ? "glass glass-on-light text-(--shop-ink)"
                        : "text-(--shop-mute) hover:text-(--shop-ink)"
                    }`}
                  >
                    <Icon className="size-4" aria-hidden />
                    {link.label}
                  </Link>
                </li>
              );
            })}
            <li className="shrink-0 md:mt-4 md:w-full md:border-t md:border-(--shop-hairline-soft) md:pt-4">
              <form action={signOut}>
                <button
                  type="submit"
                  className="glass-press flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-full px-4 text-sm font-medium text-(--shop-mute) transition-colors duration-300 hover:text-(--shop-ink)"
                >
                  <LogOut className="size-4" aria-hidden />
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        </nav>

        <div className="min-w-0 pb-8">{children}</div>
      </div>
    </div>
  );
}

/** Centred column for the signed-out auth screens. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16 md:py-24">
      <h1 className="display text-[clamp(2rem,7vw,3rem)]">{title}</h1>
      {description && (
        <p className="mb-8 mt-3 text-[15px] leading-relaxed text-(--shop-mute)">
          {description}
        </p>
      )}
      <div className={description ? "" : "mt-8"}>{children}</div>
    </div>
  );
}
