"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Contextual save bar.
 *
 * Floats just under the topbar and appears only once the record differs from
 * what was loaded, so "is there anything to save?" is answerable at a glance
 * instead of by hunting for a button. Rendered as an inset, rounded, elevated
 * card rather than a full-bleed slab so it reads as a control hovering over the
 * page — not a band of chrome awkwardly bisecting the content.
 */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  message,
  saveLabel = "Save",
  disabled = false,
  disabledReason,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** replaces the default "Unsaved changes" copy — e.g. a validation problem */
  message?: string;
  saveLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  // Cmd/Ctrl+S saves instead of invoking the browser's page-save dialog.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving && !disabled) onSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, saving, disabled, onSave]);

  // Reload / close guard. In-app navigation is covered by the bar staying
  // visible; the browser only lets us intercept the hard exits.
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  return (
    <div
      // Rendered always, hidden by transform, so the entrance animates rather
      // than the element popping into existence and shifting the page.
      aria-hidden={!dirty}
      className={cn(
        "sticky top-[4.25rem] z-30 mb-6",
        "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
        dirty
          ? "translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-3 opacity-0"
      )}
    >
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-sidebar py-2 pr-2 pl-4 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/5">
        {/* Amber dot: a calm, unmissable "pending" cue that carries the meaning
            even before the text is read. */}
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.18)]"
        />
        <p
          role="status"
          aria-live="polite"
          className="mr-auto truncate text-sm font-medium"
        >
          {message ?? "Unsaved changes"}
        </p>

        <Button
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          disabled={saving}
          tabIndex={dirty ? 0 : -1}
          className="text-white/70 hover:bg-white/10 hover:text-white"
        >
          Discard
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || disabled}
          tabIndex={dirty ? 0 : -1}
          title={disabled ? disabledReason : undefined}
          // Primary lives on a near-black surface, so it goes white-on-dark to
          // stay unmistakably the primary action instead of vanishing into it.
          className="bg-white text-sidebar shadow-sm hover:bg-white/90"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
