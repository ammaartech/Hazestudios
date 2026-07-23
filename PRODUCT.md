# Product

## Register

product

## Users

Store operators — the owner and a small staff team (`staff_roles`: owner / admin / staff) running a
single Hazestudios storefront. They work in a browser on a desktop, usually with the admin open in a
tab all day alongside the live shop. Their context is repetitive and interruption-heavy: add a
product between packing orders, fix a price while on the phone with a supplier, bulk-archive last
season at the end of a month.

The job to be done is never "explore the admin". It is always a specific mutation — get this product
live, get this order out, find out why stock is wrong. Every screen is a task, and the measure of the
UI is how few seconds and how little doubt sit between intent and a committed write.

## Product Purpose

A self-hosted Shopify-equivalent admin over a Supabase Postgres backend, plus the storefront it
drives. It exists so the store is not renting its own catalogue, order history, and customer list
from a SaaS vendor — the data lives in tables the owner controls, and the admin is the operator
surface over those tables.

Success is parity-of-capability with the Shopify admin for the workflows this store actually runs
(products, collections, inventory, orders, customers, discounts, settings), with the destructive-
edge cases handled correctly: no silent data loss, no partial writes, no stale reads after a save.

## Brand Personality

Precise, quiet, quick. The admin has no voice of its own to project — the storefront carries the
brand. In here, personality shows up as competence: labels that say exactly what a field does,
errors that name the field that failed, buttons that commit the moment they are pressed.

Emotional goal is confidence. The operator should never wonder whether a save landed, whether a
number is stale, or whether clicking a thing will destroy something.

## Anti-references

- **Shopify's own polish deficit.** Shopify is the functional reference, not the visual one. Its
  admin has grown inconsistent controls, competing save affordances, and pages that reflow after
  load. Match its capability; do not inherit its drift.
- **Generic SaaS-dashboard slop.** Hero metric tiles with gradient accents, endless identical
  icon-heading-text card grids, decorative sparklines that encode nothing. This is an operations
  tool, not a pitch deck.
- **Decorative motion.** No orchestrated page-load chorus, no scroll reveals, no bounce. The
  operator is mid-task; nothing should animate that is not reporting a state change.
- **Modal-first design.** A modal for anything that could have been inline is a failure. Editing a
  product does not deserve a dialog; confirming an irreversible delete does.

## Design Principles

1. **Earned familiarity.** Operators arrive fluent in Shopify's layout. Keep the shapes they already
   know — two-column product editor, left nav by domain, contextual save bar — and win on execution
   rather than novelty. A rearranged admin costs the user real time and buys nothing.

2. **The write is the product.** Every screen exists to commit a change. Optimise the path to a
   correct, atomic, visibly-confirmed write above all else — including above visual ambition. A
   beautiful form that half-saves is a broken form.

3. **State, never guesswork.** Dirty, saving, saved, failed, empty, loading — each has a distinct,
   always-visible representation. The operator should be able to answer "did that land?" without
   refreshing.

4. **Latency is a design bug.** Interaction feedback is immediate and local; network work happens
   behind it. A click that waits on Postgres before acknowledging itself is treated as a defect, not
   a constraint.

5. **Density is a courtesy.** These users look at the same screen fifty times a week. Show the
   fields, show the rows, keep the scroll short. Progressive disclosure is for genuinely rare
   options, not for making a screenshot look calm.

## Accessibility & Inclusion

Target WCAG 2.2 AA.

- Body text ≥4.5:1 against its surface; placeholders held to the same bar rather than the default
  muted gray. Large/bold text ≥3:1.
- Full keyboard operation for every workflow: the product editor, the variant table, media reorder,
  and the save bar are all reachable and operable without a pointer. Visible focus rings everywhere,
  never removed for aesthetics.
- Status is never colour-only. Draft / active / archived and payment / fulfilment states carry text
  or shape alongside hue, for deuteranopia and for greyscale printing of packing slips.
- `prefers-reduced-motion: reduce` collapses every transition to an instant or crossfade state
  change. No animation is load-bearing for comprehension.
- All form controls have persistent labels, not placeholder-as-label. Errors are announced, tied to
  their input, and describe the fix.
