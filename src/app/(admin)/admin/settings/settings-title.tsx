"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { SECTIONS } from "./settings-nav";

/**
 * The settings section's page title.
 *
 * Every other admin page states where you are in an `<h1>`; the settings panes
 * did not, so the only cue was which row of the sidebar happened to be
 * highlighted — and on a narrow screen, where that nav collapses out of view,
 * there was no cue at all.
 *
 * Read from `SECTIONS` rather than passed in by each page, because that list is
 * already the source of truth for what these panes are called. A title prop on
 * eighteen pages is eighteen chances for the heading and the nav to disagree.
 */
export function SettingsTitle() {
  const pathname = usePathname();

  // Longest match wins, so a nested route still resolves to its section.
  const active = [...SECTIONS]
    .filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return <PageHeader title={active?.label ?? "Settings"} />;
}
