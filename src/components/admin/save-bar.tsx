"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Contextual save bar.
 *
 * Sticks under the topbar and appears only once the record differs from what
 * was loaded, so "is there anything to save?" is answerable at a glance instead
 * of by hunting for a button. Takes the topbar's own dark surface, so it reads
 * as chrome rather than as content that appeared mid-page.
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
        "sticky top-14 z-30 -mx-4 mb-4 md:-mx-8",
        "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
        dirty
          ? "translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-2 opacity-0"
      )}
    >
      <div className="flex items-center gap-3 bg-[#1a1a1a] px-4 py-2.5 text-white shadow-lg md:px-8">
        <p
          role="status"
          aria-live="polite"
          className="mr-auto truncate text-sm font-medium"
        >
          {message ?? "Unsaved changes"}
        </p>

        <Button
          variant="outline"
          size="sm"
          onClick={onDiscard}
          disabled={saving}
          tabIndex={dirty ? 0 : -1}
          className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
        >
          Discard
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || disabled}
          tabIndex={dirty ? 0 : -1}
          title={disabled ? disabledReason : undefined}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
