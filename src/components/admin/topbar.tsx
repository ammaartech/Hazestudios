"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShoppingBag, LogOut, ExternalLink, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { GlobalSearch } from "@/components/admin/global-search";
import { openAdminSearch } from "@/lib/search/open-search";
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
        className="flex h-full shrink-0 items-center gap-2.5 px-4 transition-colors duration-150 hover:bg-sidebar-hover md:w-60 md:border-r md:border-sidebar-border"
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
      <div className="pointer-events-none absolute left-1/2 w-[min(36rem,calc(100vw-30rem))] -translate-x-1/2 max-md:contents">
        {/*
          `max-md:contents` — the wrapper generates no box at all on a phone.

          It centres the field on desktop by way of `-translate-x-1/2`, and a
          transformed element becomes the containing block for any `fixed`
          descendant. So the full-screen mobile search panel was resolving
          `inset-0` against this 0px-wide wrapper instead of the viewport and
          collapsing into a sliver in the corner. Zeroing the translate does not
          help: `translate(0)` is still a transform. `display: contents` removes
          the box, and with it the containing block, the width clamp — which
          computes negative below 480px — and the absolute positioning, all of
          which are desktop-only concerns.

          The whole search experience lives in GlobalSearch — this used to be a
          bare input whose only behaviour was to push `?q=` at the products list
          on Enter, which meant every lookup cost a page load and could only
          ever find products. It now ranks the catalogue in the browser as you
          type and merges orders and customers in from Postgres behind it. See
          `src/lib/search/fuzzy.ts` for how the ranking works.

          The panel it opens is a child of this header, which is `fixed` with a
          z-index and therefore its own stacking context — so the dropdown
          paints above the page without a portal, and stays anchored to the
          input with no positioning maths.
        */}
        <GlobalSearch />
      </div>

      {/* Takes the slack the absolutely-positioned search no longer occupies,
          keeping the avatar hard right. */}
      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-1 px-3">
        {/* On a phone the field itself is collapsed — this is how you reach it.
            44px so it is a real touch target, not a 24px icon. */}
        <button
          type="button"
          onClick={openAdminSearch}
          aria-label="Search the admin"
          className="flex size-11 cursor-pointer items-center justify-center rounded-full text-sidebar-foreground active:bg-sidebar-hover md:hidden"
        >
          <Search className="size-5" />
        </button>

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
