"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, ShoppingBag, LogOut, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Topbar({
  storeName,
  userEmail,
}: {
  storeName: string;
  userEmail: string;
}) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center bg-sidebar text-sidebar-foreground">
      {/* Brand sits exactly over the sidebar column so the chrome reads as one L. */}
      <Link
        href="/admin"
        className="flex h-full w-60 shrink-0 items-center gap-2.5 border-r border-sidebar-border px-4 transition-colors duration-150 hover:bg-white/[0.04]"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm ring-1 ring-white/10">
          <ShoppingBag className="size-4" strokeWidth={2.25} />
        </span>
        <span className="truncate text-[15px] font-semibold tracking-tight text-white">
          {storeName}
        </span>
      </Link>

      {/* Search centered over the content column. */}
      <div className="flex flex-1 justify-center px-4">
        <div className="relative w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/70" />
          <input
            type="text"
            placeholder="Search products, orders, customers…"
            aria-label="Search the admin"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.05] pl-9 pr-3 text-sm text-white outline-none transition-colors duration-150 placeholder:text-sidebar-foreground/70 hover:bg-white/[0.07] focus-visible:border-sidebar-ring focus-visible:bg-white/[0.08] focus-visible:ring-3 focus-visible:ring-sidebar-ring/30"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const q = (e.target as HTMLInputElement).value.trim();
                // `/products` is the storefront; admin search belongs on the
                // admin route, which is where this was landing wrong before.
                if (q) router.push(`/admin/products?q=${encodeURIComponent(q)}`);
              }
            }}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="cursor-pointer rounded-full outline-none ring-offset-2 ring-offset-sidebar transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/60">
            <Avatar className="size-8 ring-1 ring-white/15">
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-xs font-normal text-muted-foreground">Signed in as</span>
              <span className="truncate text-sm font-medium text-foreground">{userEmail}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer">
              <a href="/" target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                View store
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="cursor-pointer">
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
