"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ChevronsUpDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { searchOrderCustomers, type PickerCustomer } from "./search-actions";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Customer selection against a 3,952-row table. The old control was a `<select>`
 * holding every customer, which shipped 614 KB and still could not be searched —
 * and the imported list is full of near-identical rows that only differ by
 * email, so the contact line is part of the choice, not decoration.
 */
export function CustomerPicker({
  value,
  onChange,
}: {
  value: PickerCustomer | null;
  onChange: (customer: PickerCustomer | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PickerCustomer[]>([]);
  const [loading, startSearch] = useTransition();
  const requestRef = useRef(0);

  const runSearch = useCallback((value: string) => {
    const request = ++requestRef.current;
    startSearch(async () => {
      const rows = await searchOrderCustomers(value);
      if (request === requestRef.current) setResults(rows);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => runSearch(term), term ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(id);
  }, [term, open, runSearch]);

  // Clearing on close belongs in the handler, not an effect — the effect would
  // set state during a render pass it does not own.
  function changeOpen(next: boolean) {
    if (!next) setTerm("");
    setOpen(next);
  }

  if (value) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.name}</p>
          {value.email && (
            <p className="truncate text-xs text-muted-foreground">{value.email}</p>
          )}
          {value.phone && (
            <p className="truncate text-xs text-muted-foreground">{value.phone}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="Remove customer"
          onClick={() => onChange(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal text-muted-foreground"
        >
          Search for a customer
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-0"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Name, email or phone"
              aria-label="Search customers"
              className="h-8 pl-8"
            />
          </div>
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {loading ? "Searching…" : "No customers found"}
            </li>
          ) : (
            results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-muted/60"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                >
                  <span className="block truncate text-sm">{c.name}</span>
                  {(c.email || c.phone) && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.email ?? c.phone}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
