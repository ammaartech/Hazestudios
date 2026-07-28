import type { Collection } from "@/lib/types";
import { NAV, type NavGroup } from "./home-content";

export interface ResolvedLink {
  label: string;
  href: string;
  note?: string;
}

export interface ResolvedGroup {
  label: string;
  href?: string;
  links: ResolvedLink[];
  /** Children carry sub-copy, so the panel spans the viewport in columns. */
  wide: boolean;
}

/**
 * Turns the authored menu into one the catalogue can actually serve.
 *
 * A link whose collection is missing or unpublished is dropped rather than
 * rendered dead, and a group emptied by that is dropped with it — so the menu
 * shrinks to what exists today and grows as collections go live, without anyone
 * editing two places. Collection titles win over authored labels for the same
 * reason: renaming a collection in the admin should rename it in the menu.
 */
export function resolveNav(collections: Collection[]): ResolvedGroup[] {
  const byHandle = new Map(collections.map((c) => [c.handle, c]));

  const groups = NAV.map((group: NavGroup): ResolvedGroup => {
    const links = group.children
      .filter((child) => byHandle.has(child.handle))
      .map((child) => ({
        label: byHandle.get(child.handle)!.title,
        href: `/collections/${child.handle}`,
        note: child.note,
      }));

    return {
      label: group.label,
      href: group.handle && byHandle.has(group.handle)
        ? `/collections/${group.handle}`
        : undefined,
      links,
      wide: links.some((l) => l.note),
    };
  }).filter((group) => group.links.length > 0 || group.href);

  // A catalogue that matches none of the authored handles — a fresh install, or
  // one merchandised under different names — still needs a usable menu, so every
  // published collection becomes its own top-level link.
  if (!groups.length) {
    return collections.map((c) => ({
      label: c.title,
      href: `/collections/${c.handle}`,
      links: [],
      wide: false,
    }));
  }

  return groups;
}
