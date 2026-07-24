"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUp, Plus, Sparkles } from "lucide-react";

export interface Suggestion {
  label: string;
  href: string;
  count?: number;
}

/**
 * The Home prompt bar.
 *
 * Presentational for now — there is no assistant behind it, so rather than
 * pretending to answer, submitting hands the text to admin search. That keeps
 * the control honest and still useful.
 */
export function AskBar({ suggestions }: { suggestions: Suggestion[] }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function submit() {
    const query = value.trim();
    if (!query) return;
    router.push(`/admin/products?q=${encodeURIComponent(query)}`);
  }

  return (
    <div className="w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 rounded-2xl border bg-card px-3 py-2.5 shadow-sm transition-shadow duration-150 focus-within:shadow-md"
      >
        <Sparkles className="size-5 shrink-0 text-violet-500" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search products, orders and customers…"
          aria-label="Search the admin"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          aria-label="Add context"
          className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="submit"
          aria-label="Search"
          disabled={!value.trim()}
          className="cursor-pointer rounded-full bg-foreground p-1.5 text-background transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>

      {suggestions.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-[13px] font-medium shadow-sm transition-colors duration-150 hover:bg-muted"
            >
              {s.label}
              {s.count !== undefined && (
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                  {s.count}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
