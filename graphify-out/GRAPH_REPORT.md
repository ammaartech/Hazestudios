# Graph Report - Hazestudios  (2026-07-19)

## Corpus Check
- 129 files · ~31,693 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 591 nodes · 1614 edges · 29 communities (23 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `76d976d7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 129 edges
2. `createClient()` - 35 edges
3. `Button()` - 30 edges
4. `Card()` - 28 edges
5. `CardContent()` - 28 edges
6. `formatMoney()` - 22 edges
7. `PageHeader()` - 21 edges
8. `Input()` - 20 edges
9. `CardHeader()` - 16 edges
10. `CardTitle()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `SortableThumb()` --calls--> `cn()`  [EXTRACTED]
  src/components/admin/media-uploader.tsx → src/lib/utils.ts
- `ToolbarButton()` --calls--> `cn()`  [EXTRACTED]
  src/components/admin/rich-text-editor.tsx → src/lib/utils.ts
- `Dot()` --calls--> `cn()`  [EXTRACTED]
  src/components/admin/status-badges.tsx → src/lib/utils.ts
- `Pill()` --calls--> `cn()`  [EXTRACTED]
  src/components/admin/status-badges.tsx → src/lib/utils.ts
- `AlertAction()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/alert.tsx → src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (29 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (63): FilterTabs(), PageHeader(), HomePage(), metadata, DiscountStatusBadge(), Dot(), FulfillmentBadge(), PaymentBadge() (+55 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (42): CollectionPayload, deleteCollection(), saveCollection(), CollectionFormInitial, PRICE_OPERATORS, RULE_FIELDS, TEXT_OPERATORS, DiscountDialog() (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (29): MediaUploader(), SortableThumb(), SearchInput(), BrandForm(), metadata, CollectionForm(), deleteDiscount(), DiscountPayload (+21 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (47): dependencies, class-variance-authority, clsx, cmdk, date-fns, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities (+39 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (30): DraftImage, metadata, InventoryGrid(), InventoryRow, metadata, productMatchesRules(), Collection, InventoryLevel (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (27): OrdersBarChart(), SalesAreaChart(), TooltipPayloadEntry, TopProductsChart(), metadata, GeneralForm(), metadata, ConvertDraftButton() (+19 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (14): metadata, ComingSoon(), metadata, metadata, metadata, metadata, metadata, metadata (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (26): cn(), CardAction(), CardFooter(), Command(), CommandDialog(), CommandEmpty(), CommandGroup(), CommandInput() (+18 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (13): TagsInput(), CustomerPayload, deleteCustomer(), deleteSegment(), saveCustomer(), saveSegment(), customerMatchesFilters(), Customer (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (12): RichTextEditor(), ToolbarButton(), InputGroupAddon(), inputGroupAddonVariants, InputGroupButton(), inputGroupButtonVariants, InputGroupInput(), InputGroupText() (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.16
Nodes (11): DropdownMenu(), DropdownMenuCheckboxItem(), DropdownMenuContent(), DropdownMenuItem(), DropdownMenuLabel(), DropdownMenuRadioItem(), DropdownMenuSeparator(), DropdownMenuShortcut() (+3 more)

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (9): mainNav, NavChild, NavItem, salesChannelNav, isActive(), NavEntry(), sectionActive(), Sidebar() (+1 more)

### Community 14 - "Community 14"
Cohesion: 0.18
Nodes (6): SheetContent(), SheetDescription(), SheetFooter(), SheetHeader(), SheetOverlay(), SheetTitle()

### Community 15 - "Community 15"
Cohesion: 0.25
Nodes (4): PopoverContent(), PopoverDescription(), PopoverHeader(), PopoverTitle()

### Community 16 - "Community 16"
Cohesion: 0.33
Nodes (4): geistMono, inter, metadata, Toaster()

### Community 17 - "Community 17"
Cohesion: 0.29
Nodes (6): Avatar(), AvatarBadge(), AvatarFallback(), AvatarGroup(), AvatarGroupCount(), AvatarImage()

### Community 18 - "Community 18"
Cohesion: 0.33
Nodes (5): Architecture notes, Hazestudios, Roadmap, Setup, What's functional

### Community 19 - "Community 19"
Cohesion: 0.40
Nodes (5): Tabs(), TabsContent(), TabsList(), tabsListVariants, TabsTrigger()

### Community 21 - "Community 21"
Cohesion: 0.60
Nodes (3): config, middleware(), updateSession()

## Knowledge Gaps
- **151 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+146 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Community 7` to `Community 0`, `Community 1`, `Community 2`, `Community 5`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 17`, `Community 19`, `Community 20`, `Community 22`?**
  _High betweenness centrality (0.226) - this node is a cross-community bridge._
- **Why does `Card()` connect `Community 5` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 6`, `Community 7`, `Community 9`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `CardContent()` connect `Community 5` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 6`, `Community 7`, `Community 9`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _151 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06031746031746032 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1047065044949762 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.060408163265306125 - nodes in this community are weakly interconnected._