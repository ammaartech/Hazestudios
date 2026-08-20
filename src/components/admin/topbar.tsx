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
    // The light chrome needs a hairline to separate it from the content plane;
    // the dark fill used to do that work on its own.
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand sits exactly over the sidebar column so the chrome reads as one L. */}
      <Link
        href="/admin"
        className="flex h-full w-60 shrink-0 items-center gap-2.5 border-r border-sidebar-border px-4 transition-colors duration-150 hover:bg-sidebar-hover"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm ring-1 ring-black/5">
          <ShoppingBag className="size-4" strokeWidth={2.25} />
        </span>
        <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
          {storeName}
        </span>
      </Link>

      {/*
        Centred on the *viewport*, not on the space left over beside the brand.
        Flowing it as a flex child made it centre within the gap between the
        240px brand block and the avatar, which puts it visibly right of the
        page's own centre line. Taking it out of flow and pinning it to 50% of
        the header centres it over the window, which is where the eye expects
        it and where the content column below is centred too.

        `max-w-2xl` with `w-[min(…)]` so it grows on wide screens but never
        collides with the brand or the avatar on narrow ones.
      */}
      <div className="pointer-events-none absolute left-1/2 hidden w-[min(36rem,calc(100vw-30rem))] -translate-x-1/2 md:block">
        <div className="pointer-events-auto relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search"
            aria-label="Search the admin"
            // Light chrome, so this takes the same glass-control material as the
            // page's own controls rather than the dark glass-chrome variant.
            className="glass-control h-10 w-full rounded-lg border-0 pl-10 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/30"
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

      {/* Takes the slack the absolutely-positioned search no longer occupies,
          keeping the avatar hard right. */}
      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-1 px-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="cursor-pointer rounded-full outline-none ring-offset-2 ring-offset-sidebar transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="size-8 ring-1 ring-black/10">
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
