"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  OPTION_NAME_SUGGESTIONS,
  isColorOption,
  presetFor,
  swatchFor,
} from "@/lib/variant-presets";
import { cn } from "@/lib/utils";
import type { OptionDraft } from "../product-draft";

const MAX_VALUE_LENGTH = 60;

/** optionKey → { oldValue: newValue }, handed up so overrides can follow. */
export type ValueRenames = Record<string, Record<string, string>>;

export interface OptionEditorProps {
  options: OptionDraft[];
  /** `renames` is set only when a value was edited in place */
  onChange: (next: OptionDraft[], renames?: ValueRenames) => void;
  max: number;
}

export function OptionEditor({ options, onChange, max }: OptionEditorProps) {
  // One option is open at a time. Editing two at once invites half-finished
  // rows, and the collapsed summary is the state the operator reads from.
  const [editing, setEditing] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = options.findIndex((o) => o.key === active.id);
    const to = options.findIndex((o) => o.key === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(options, from, to));
  }

  function addOption() {
    const key = crypto.randomUUID();
    onChange([...options, { key, name: "", values: [] }]);
    setEditing(key);
  }

  const atLimit = options.length >= max;

  return (
    <div className="rounded-lg border border-input">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up option ${active.id}.`,
            onDragOver: ({ over }) =>
              over ? `Option moved over ${over.id}.` : "",
            onDragEnd: ({ over }) =>
              over ? "Option dropped into position." : "Move cancelled.",
            onDragCancel: () => "Move cancelled.",
          },
        }}
      >
        <SortableContext
          items={options.map((o) => o.key)}
          strategy={verticalListSortingStrategy}
        >
          {options.map((option, index) => (
            <SortableOption
              key={option.key}
              option={option}
              index={index}
              editing={editing === option.key}
              siblings={options.filter((o) => o.key !== option.key)}
              onEdit={() => setEditing(option.key)}
              onDone={() => setEditing(null)}
              onChange={(next, renames) =>
                onChange(
                  options.map((o) => (o.key === option.key ? next : o)),
                  renames
                )
              }
              onDelete={() => {
                setEditing(null);
                onChange(options.filter((o) => o.key !== option.key));
              }}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div className="p-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          disabled={atLimit}
          title={
            atLimit ? `A product can have at most ${max} options.` : undefined
          }
          onClick={addOption}
        >
          <Plus className="size-3.5" />
          {options.length === 0 ? "Add options like size or colour" : "Add another option"}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SortableOption({
  option,
  index,
  editing,
  siblings,
  onEdit,
  onDone,
  onChange,
  onDelete,
}: {
  option: OptionDraft;
  index: number;
  editing: boolean;
  siblings: OptionDraft[];
  onEdit: () => void;
  onDone: () => void;
  onChange: (next: OptionDraft, renames?: ValueRenames) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: option.key });

  const preset = presetFor(option.name);
  const nameTaken = siblings.some(
    (o) => o.name.trim().toLowerCase() === option.name.trim().toLowerCase() && o.name.trim()
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-1 border-b border-border p-2 last:border-b-0",
        isDragging && "relative z-10 rounded-lg bg-card shadow-lg ring-2 ring-ring/40"
      )}
    >
      {/* The handle is its own control, never the whole row: the row contains
          inputs, and a row-wide drag listener would swallow text selection. */}
      <button
        type="button"
        aria-label={`Reorder option ${option.name || index + 1}`}
        {...attributes}
        {...listeners}
        className="mt-1.5 flex size-6 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-3 p-1">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`opt-name-${option.key}`} className="text-xs">
                  Option name
                </Label>
                {preset && (
                  <Badge variant="secondary" className="font-normal">
                    {preset.name}
                  </Badge>
                )}
              </div>
              <OptionNameInput
                id={`opt-name-${option.key}`}
                value={option.name}
                invalid={nameTaken}
                onChange={(name) => onChange({ ...option, name })}
              />
              {nameTaken && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  Another option already uses this name.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Option values</Label>
              <ValueEditor
                option={option}
                onChange={onChange}
                onCommit={onDone}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={onDelete}
              >
                Delete
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!option.name.trim() || option.values.length === 0}
                title={
                  !option.name.trim()
                    ? "Name this option first."
                    : option.values.length === 0
                      ? "Add at least one value."
                      : undefined
                }
                onClick={onDone}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="w-full cursor-pointer space-y-1.5 rounded-md p-1 text-left transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="block text-sm font-medium">
              {option.name.trim() || (
                <span className="text-muted-foreground">Untitled option</span>
              )}
            </span>
            {option.values.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {option.values.map((value) => (
                  <ValueChip key={value} value={value} option={option} />
                ))}
              </span>
            ) : (
              <span className="block text-xs text-muted-foreground">
                No values yet
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Static chip, used in the collapsed summary. */
function ValueChip({ value, option }: { value: string; option: OptionDraft }) {
  const swatch = isColorOption(option.name) ? swatchFor(value) : null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
      {swatch && <Swatch fill={swatch} />}
      <span className="max-w-40 truncate">{value}</span>
    </span>
  );
}

function Swatch({ fill }: { fill: string }) {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-[3px] border border-foreground/15"
      style={{ background: fill }}
    />
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The value list: sortable chips that rename in place, plus a combobox that
 * offers the preset values for whatever the option was named.
 */
function ValueEditor({
  option,
  onChange,
  onCommit,
}: {
  option: OptionDraft;
  onChange: (next: OptionDraft, renames?: ValueRenames) => void;
  /** Enter on an empty input finishes the option, matching the Done button. */
  onCommit: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `${option.key}-values`;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const taken = useMemo(
    () => new Set(option.values.map((v) => v.toLowerCase())),
    [option.values]
  );

  const suggestions = useMemo(() => {
    const preset = presetFor(option.name);
    if (!preset) return [];
    const q = draft.trim().toLowerCase();
    return preset.values
      .filter((v) => !taken.has(v.toLowerCase()))
      .filter((v) => (q ? v.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [option.name, draft, taken]);

  const trimmed = draft.trim();
  const canCreate =
    trimmed.length > 0 &&
    !taken.has(trimmed.toLowerCase()) &&
    !suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase());

  const rows = canCreate ? [trimmed, ...suggestions] : suggestions;
  const hasRows = rows.length > 0;

  function addValues(raw: string) {
    const incoming = raw
      .split(",")
      .map((v) => v.trim().slice(0, MAX_VALUE_LENGTH))
      .filter(Boolean);
    if (!incoming.length) return;

    const next = [...option.values];
    const seen = new Set(next.map((v) => v.toLowerCase()));
    for (const value of incoming) {
      if (seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      next.push(value);
    }
    onChange({ ...option, values: next });
    setDraft("");
    setHighlight(0);
  }

  function renameValue(from: string, to: string) {
    const clean = to.trim().slice(0, MAX_VALUE_LENGTH);
    if (!clean || clean === from) return;
    // A rename onto an existing sibling would create a duplicate combination,
    // so it is refused rather than silently merged.
    if (option.values.some((v) => v !== from && v.toLowerCase() === clean.toLowerCase())) {
      return;
    }
    onChange(
      { ...option, values: option.values.map((v) => (v === from ? clean : v)) },
      { [option.key]: { [from]: clean } }
    );
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
        if (open && hasRows) addValues(rows[highlight] ?? trimmed);
        else if (trimmed) addValues(trimmed);
        else if (option.values.length) onCommit();
        break;
      case "Tab":
        if (trimmed) {
          e.preventDefault();
          addValues(trimmed);
        }
        break;
      case ",":
        e.preventDefault();
        addValues(draft);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case "Backspace":
        if (!draft && option.values.length) {
          onChange({ ...option, values: option.values.slice(0, -1) });
        }
        break;
    }
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = option.values.indexOf(String(active.id));
    const to = option.values.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    // Reordering values never changes a variant title, so overrides are safe.
    onChange({ ...option, values: arrayMove(option.values, from, to) });
  }

  return (
    <Popover open={open && hasRows} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "rounded-lg border border-input bg-transparent p-1.5 transition-colors duration-150",
            "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
          )}
        >
          {option.values.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              accessibility={{
                announcements: {
                  onDragStart: ({ active }) => `Picked up value ${active.id}.`,
                  onDragOver: ({ over }) =>
                    over ? `Value moved over ${over.id}.` : "",
                  onDragEnd: ({ over }) =>
                    over ? "Value dropped into position." : "Move cancelled.",
                  onDragCancel: () => "Move cancelled.",
                },
              }}
            >
              <SortableContext
                items={option.values}
                strategy={horizontalListSortingStrategy}
              >
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {option.values.map((value) => (
                    <SortableValue
                      key={value}
                      value={value}
                      option={option}
                      onRename={(to) => renameValue(value, to)}
                      onRemove={() =>
                        onChange({
                          ...option,
                          values: option.values.filter((v) => v !== value),
                        })
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open && hasRows}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && hasRows ? `${listId}-${highlight}` : undefined
            }
            aria-label={`Add a value to ${option.name || "this option"}`}
            value={draft}
            placeholder={
              option.values.length
                ? "Add another value"
                : `Add ${option.name.trim().toLowerCase() || "value"}`
            }
            maxLength={MAX_VALUE_LENGTH}
            className="w-full bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => {
              setDraft(e.target.value);
              setHighlight(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Commit rather than discard — a typed value lost to a stray
              // click is the most irritating thing this control could do.
              if (trimmed) addValues(trimmed);
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
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-(--radix-popover-trigger-width) p-1"
      >
        {suggestions.length > 0 && (
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
            Suggested values
          </p>
        )}
        {rows.map((row, i) => {
          const isCreate = canCreate && i === 0;
          const swatch = isColorOption(option.name) ? swatchFor(row) : null;
          return (
            <div
              key={`${isCreate ? "create" : "value"}-${row}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                // mousedown, not click: blur fires first and would close the
                // popover before the selection registered.
                e.preventDefault();
                addValues(row);
                inputRef.current?.focus();
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-100",
                i === highlight && "bg-accent text-accent-foreground"
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
                  {swatch ? <Swatch fill={swatch} /> : <span className="size-3" />}
                  <span className="truncate">{row}</span>
                </>
              )}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */

/** A draggable value chip that becomes a text field when clicked. */
function SortableValue({
  value,
  option,
  onRename,
  onRemove,
}: {
  value: string;
  option: OptionDraft;
  onRename: (next: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: value });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const swatch = isColorOption(option.name) ? swatchFor(value) : null;

  function commit() {
    setEditing(false);
    onRename(draft);
  }

  return (
    <span
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-secondary py-0.5 pl-1 pr-1 text-xs font-medium text-secondary-foreground",
        isDragging && "z-10 shadow-md ring-2 ring-ring/40"
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${value}`}
        {...attributes}
        {...listeners}
        className="flex size-4 cursor-grab items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
      >
        <GripVertical className="size-3" />
      </button>

      {swatch && <Swatch fill={swatch} />}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label={`Rename ${value}`}
          maxLength={MAX_VALUE_LENGTH}
          // Sized to its content so the chip does not jump width on edit.
          size={Math.max(draft.length, 4)}
          className="bg-transparent text-xs font-medium outline-none"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(value);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          title="Rename"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="max-w-40 cursor-text truncate rounded-sm px-0.5 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {value}
        </button>
      )}

      <button
        type="button"
        aria-label={`Remove ${value}`}
        onClick={onRemove}
        className="cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors duration-150 hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/** Option name field with a suggestion list for the names we have presets for. */
function OptionNameInput({
  id,
  value,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    return OPTION_NAME_SUGGESTIONS.filter(
      (n) => n.toLowerCase() !== q && (q ? n.toLowerCase().includes(q) : true)
    );
  }, [value]);

  return (
    <Popover open={open && matches.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div>
          <Input
            id={id}
            autoComplete="off"
            placeholder="Size"
            value={value}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && open) {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        role="listbox"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-(--radix-popover-trigger-width) p-1"
      >
        {matches.map((name) => (
          <div
            key={name}
            role="option"
            aria-selected={false}
            onMouseDown={(e) => {
              e.preventDefault();
              onChange(name);
              setOpen(false);
            }}
            className="cursor-pointer rounded-md px-2 py-1.5 text-sm transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
          >
            {name}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
