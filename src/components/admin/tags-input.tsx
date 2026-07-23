"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_TAG_LENGTH = 40;

/**
 * Tag combobox: free text plus autocomplete over tags already used in the store.
 *
 * The suggestion list is portalled through Popover rather than absolutely
 * positioned, because `Card` sets `overflow-hidden` — an in-flow dropdown would
 * be clipped by the panel it sits in.
 */
export function TagsInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Search or add tags",
  id,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  id?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-listbox`;

  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLower = useMemo(
    () => new Set(value.map((t) => t.toLowerCase())),
    [value]
  );

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return suggestions
      .filter((s) => !selectedLower.has(s.toLowerCase()))
      .filter((s) => (q ? s.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [suggestions, selectedLower, draft]);

  const trimmed = draft.trim();
  const canCreate =
    trimmed.length > 0 &&
    trimmed.length <= MAX_TAG_LENGTH &&
    !selectedLower.has(trimmed.toLowerCase()) &&
    !matches.some((m) => m.toLowerCase() === trimmed.toLowerCase());

  // Index 0 is the "create" row when it exists, so the highlight can address
  // both it and the suggestion rows with one number.
  const rows = canCreate ? [trimmed, ...matches] : matches;
  const hasRows = rows.length > 0;

  function addTags(raw: string) {
    // Splitting on comma makes a pasted "sale, summer, linen" land as three tags.
    const incoming = raw
      .split(",")
      .map((t) => t.trim().slice(0, MAX_TAG_LENGTH))
      .filter(Boolean);
    if (!incoming.length) return;

    const next = [...value];
    const seen = new Set(next.map((t) => t.toLowerCase()));
    for (const tag of incoming) {
      if (seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      next.push(tag);
    }
    onChange(next);
    setDraft("");
    setHighlight(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        if (!hasRows) return;
        e.preventDefault();
        setOpen(true);
        setHighlight((h) => (h + 1) % rows.length);
        break;
      case "ArrowUp":
        if (!hasRows) return;
        e.preventDefault();
        setOpen(true);
        setHighlight((h) => (h - 1 + rows.length) % rows.length);
        break;
      case "Enter":
        e.preventDefault();
        if (open && hasRows) addTags(rows[highlight] ?? trimmed);
        else if (trimmed) addTags(trimmed);
        break;
      case "Tab":
        // Tab commits what's typed rather than leaving it stranded in the box.
        if (trimmed) {
          e.preventDefault();
          addTags(trimmed);
        }
        break;
      case ",":
        e.preventDefault();
        addTags(draft);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case "Backspace":
        if (!draft && value.length) onChange(value.slice(0, -1));
        break;
    }
  }

  return (
    <div>
      <Popover open={open && hasRows} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div>
            <Input
              id={inputId}
              ref={inputRef}
              role="combobox"
              aria-expanded={open && hasRows}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                open && hasRows ? `${listId}-${highlight}` : undefined
              }
              value={draft}
              placeholder={placeholder}
              maxLength={MAX_TAG_LENGTH}
              onChange={(e) => {
                setDraft(e.target.value);
                setHighlight(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                // Commit rather than discard: losing a typed tag to a stray
                // click is the single most annoying thing a tag field can do.
                if (trimmed) addTags(trimmed);
                setOpen(false);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        </PopoverAnchor>

        <PopoverContent
          id={listId}
          role="listbox"
          align="start"
          sideOffset={4}
          // Focus must stay in the input; the listbox is only ever driven from it.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="w-(--radix-popover-trigger-width) p-1"
        >
          {rows.map((row, i) => {
            const isCreate = canCreate && i === 0;
            return (
              <div
                key={`${isCreate ? "create" : "tag"}-${row}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                // mousedown, not click: blur fires first on click and would
                // close the popover before the selection registered.
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTags(row);
                  inputRef.current?.focus();
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-100",
                  i === highlight ? "bg-accent text-accent-foreground" : ""
                )}
              >
                {isCreate ? (
                  <>
                    <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      Add <span className="font-medium">{row}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <Check className="size-3.5 shrink-0 opacity-0" />
                    <span className="truncate">{row}</span>
                  </>
                )}
              </div>
            );
          })}
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-secondary py-0.5 pl-2 pr-1 text-xs font-medium text-secondary-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
            >
              <span className="max-w-40 truncate">{tag}</span>
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => onChange(value.filter((t) => t !== tag))}
                className="cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors duration-150 hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
