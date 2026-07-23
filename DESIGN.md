# Design

Two registers share one codebase. **Admin** (`:root`) is a product surface — restrained, dense,
familiar. **Storefront** (`.shop`) is a brand surface — editorial, hard-edged, monochrome. They are
deliberately not the same design system; they share only the shadcn component contract and the
`cn()` utility. This document is the admin's system unless a section says otherwise.

## Theme

**Light, always, for the admin.** The scene: an operator at a desk in daytime office light, with the
live storefront (white) open in the next tab and packing slips printing beside them. A dark admin
would fight both. `.dark` tokens exist and are kept correct, but light is the shipped default.

**Storefront is light too**, for a different reason: garments photograph against white, and the
editorial reference (`design-md/nike`) reserves all chromatic energy for photography and the sale
price.

## Color

Strategy: **Restrained**. Tinted neutrals plus one accent under 10% of surface area.

The neutral ramp is tinted cool — chroma 0.002–0.006 at hue ~286 — not warm. This is a deliberate
rejection of the cream/sand default; the accent is green, and the neutrals lean toward its cool
side rather than toward generic paper-warmth.

### Admin tokens (`:root` in `src/app/globals.css`)

| Role | Value | Use |
|---|---|---|
| `--background` | `oklch(0.972 0.001 286.375)` | App canvas — a shade below card, so cards read as raised without shadow |
| `--card` / `--popover` | `oklch(1 0 0)` | Content surfaces, panels, dialogs |
| `--sidebar` | `oklch(0.985 0 0)` | The second neutral layer — nav sits between canvas and card |
| `--foreground` | `oklch(0.234 0.006 271.152)` | Body ink. ~13.8:1 on card, ~13:1 on canvas |
| `--muted-foreground` | `oklch(0.492 0.008 271.288)` | Secondary text and placeholders. ~4.9:1 on card — above the 4.5 floor, which is why it may be used for real prose and not only decoration |
| `--primary` | `oklch(0.511 0.096 165.542)` | Deep green. Primary actions, current selection, focus ring only |
| `--destructive` | `oklch(0.577 0.245 27.325)` | Delete, archive, negative deltas |
| `--border` | `oklch(0.898 0.003 286.35)` | Hairlines between rows and sections |
| `--input` | `oklch(0.871 0.004 286.32)` | Field borders — one step darker than `--border`, so controls read as interactive |

**Accent discipline.** Green appears on: the primary button, the active nav item, the focus ring,
the selected row, and nowhere else. It never tints a card background, never decorates an icon, never
appears on an inactive state.

**Semantic state vocabulary** (standardised in `src/components/admin/status-badges.tsx`): every
status is a dot or pill carrying *text plus* hue, never hue alone.

### Storefront tokens (`.shop`)

Pure `#111111` on `#ffffff` with a single gray family (`--shop-mute` `#707072`), `--radius: 0px`,
and exactly two chromatic escapes: `--shop-sale` `#d30005` and `--shop-success` `#007d48`.

## Typography

**One family, Inter** (`--font-sans`), across headings, labels, buttons, body, and data in the
admin. No display/body pairing — product UI does not need it. `Geist Mono` (`--font-mono`) is
reserved for identifiers that benefit from fixed advance width: SKUs, barcodes, order numbers, IDs.

**Fixed rem scale, not fluid.** No `clamp()` in the admin — operators view at consistent DPI, and a
heading that shrinks inside a panel looks broken rather than responsive.

| Step | Size / weight | Use |
|---|---|---|
| Page title | `text-xl` (1.25rem) / 700, `tracking-tight` | One per screen, in `PageHeader` |
| Section title | `text-base` (1rem) / 600 | `CardTitle` |
| Body / input | `text-sm` (0.875rem) / 400 | The admin's default size |
| Label | `text-sm` / 500 | Form labels |
| Meta / help | `text-xs` (0.75rem) / 400, `--muted-foreground` | Field hints, timestamps, counts |

Ratio is ~1.14–1.2 between steps. Prose in help text caps at 65–75ch; tables run as wide as the data
needs.

The storefront inverts all of this: `Archivo` display at 0.86 line-height, `-0.03em` tracking,
uppercase, plus a `.meta` micro-caps style at `0.14em`. Scoped to `.shop`; never used in the admin.

## Layout

**App shell**: fixed left sidebar (`src/components/admin/sidebar.tsx`) + topbar + content column.
Responsive behaviour is structural — the sidebar collapses to a Sheet at `lg`, tables become stacked
rows, grid columns drop by breakpoint. Type never scales.

**Editor pages** use Shopify's two-column split: `grid lg:grid-cols-[1fr_320px]`. Main column holds
the record's substance in source order (identity → media → pricing → inventory → variants → SEO);
the 320px rail holds status and organisation metadata. Below `lg` the rail stacks underneath.

**Spacing** is on a 4px base. Section gap `space-y-5` (20px), field gap `space-y-4` (16px),
label-to-control `space-y-2` (8px). Rhythm comes from varying these three, not from adding more
scale steps.

**Cards** are the panel primitive on editor and dashboard screens because they group genuinely
separable concerns that save together. Never nested. List and table screens use full-bleed bordered
regions instead — a card around a table is decoration.

**Z-index** is semantic, in this order: dropdown → sticky (save bar, table headers) → modal backdrop
→ modal → toast → tooltip.

## Motion

150–250ms, `ease-out`, on state change only. Every animation reports something: a value committed, a
panel opened, a row entered or left, an upload progressed. Nothing animates on page load — the admin
loads into a task.

- Transitions: `transition-colors duration-150` for hover/focus, `duration-200` for
  enter/exit and layout-affecting reveals.
- Transform and opacity are the default materials. Blur and shadow are used only for genuine
  elevation (dragged media thumbnail, sticky save bar shadow).
- Reduced motion: `prefers-reduced-motion: reduce` collapses everything to an instant state change.
  Already enforced globally for `.shop`; the admin honours it per-component.
- **Banned here**: scroll reveals, staggered page entrances, bounce/elastic easing, spinners in the
  middle of content (use skeletons that match the shape of what is loading).

## Components

Built on shadcn/ui with Radix primitives (`radix-ui` v1.6 unified package), variants via
`class-variance-authority`, class merging via `cn()` in `src/lib/utils.ts`.

**Every interactive component ships all seven states**: default, hover, focus-visible, active,
disabled, loading, error. A control missing one is unfinished.

Conventions the existing components already establish and new work must match:

- **Radius** derives from `--radius: 0.625rem` via the `--radius-*` scale. Never a literal value.
- **Focus** is `focus-visible:ring-3 focus-visible:ring-ring/50` plus `focus-visible:border-ring`.
  Never `outline: none` without a replacement.
- **Press** is `active:translate-y-px` — the button physically depresses. Suppressed on menu
  triggers (`aria-haspopup`).
- **Error** is `aria-invalid` driven, styled at the component level, not by ad-hoc red classes.
- **Sizes** are `xs` (h-6) / `sm` (h-7) / `default` (h-8) / `lg` (h-9). The admin's working size is
  `sm` in dense contexts and `default` everywhere else.
- **Icons** are lucide-react at `size-4` (`size-3.5` at `sm`, `size-3` at `xs`), stroke-only, never
  filled, never coloured except to carry a destructive or status meaning.
- **Loading** is a skeleton shaped like the incoming content (`src/components/ui/skeleton.tsx`), or
  an in-button `Loader2` for a scoped action. Never a centred spinner replacing a page.
- **Empty states** teach the screen: what this collection is, and the one button that creates the
  first item.
- **Toasts** are sonner, `richColors`, bottom-center. They confirm writes; they do not carry
  information available nowhere else.
- **Dialogs** are for irreversible confirmation only. `window.confirm` is not acceptable in shipped
  code.
