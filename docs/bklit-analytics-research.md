# Bklit analytics research and implementation

Reviewed 20 September 2026. Official source revision: `0dfdfc57ca068470ccfb93c4501cebc555c9054d`.

Bklit is a React chart library distributed as source through the shadcn registry. It is built on Visx and Motion; it is not a replacement for the storefront tracking service or Supabase analytics queries. The chart package is MIT licensed. Studio is a separate proprietary application; no Studio source was copied.

## Research scope

Reviewed the official installation, theme, component and utility documentation, the complete gallery variant catalog, the three public stat-card block patterns, registry manifests, and the source APIs for the selected charts. The appendix records all documentation pages and catalog examples reviewed. Selected variants were then exercised in the actual admin with store data. This is a source/documentation review plus local integration testing, not a claim to have manually exercised every public demo or third-party showcase.

Primary references: [documentation](https://bklit.com/docs/installation), [gallery](https://bklit.com/charts/area-chart), [blocks](https://bklit.com/blocks), [showcase](https://bklit.com/showcase), [source](https://github.com/bklit/bklit-ui).

## Decisions

| Pattern | Application |
| --- | --- |
| Area chart with gradient, axes and crosshair | Main metric explorer and report trends. Linear interpolation retains the shape of sparse sales data; comparison windows align by bucket position. |
| Stat-card blocks / animated values | Six keyboard-accessible KPI selectors, consistent headline hierarchy, restrained NumberFlow updates. |
| Horizontal grouped bars | Traffic and product rankings; ordered and reversed units remain separate. Full labels and exact values have a native expandable table. |
| Donut with synchronized legend | Device share, with counts and percentages always readable and focusable legend controls. |
| Layered funnel | Real tracked sessions, carts, checkout and purchases, with numeric counts and session shares beside the diagram. |
| Live line | Actual ten-second visitor observations, bounded in-memory history, pause/resume, and an observation list. Hidden/reduced-motion views use a static chart instead of a continuous animation loop. |
| Source/location and sales/units switches | Related measures share space without removing the underlying breakdowns. |

Kept date-range selection, custom dates, comparison modes, currencies, report navigation/export and the existing accounting definitions. Empty periods render explicit empty states or zero-valued series. No fabricated forecasts, activity, country attribution, conversion events, or targets were added.

Candlesticks and profit/loss variants target financial markets rather than this data. Radar/gauge/ring views would require arbitrary targets or normalized scores. Sankey and sunburst need linked journeys/hierarchies not supplied by the current aggregates. Choropleths require reliable geographic joins; the existing live map is retained. Heatmaps and brush zoom are useful future options but would duplicate the current range controls for this scope.

## Integration notes

Installed the official registry components into `src/components/charts` and added the `@bklit` namespace in `components.json`. The registry selects Visx 4 alpha packages; their resolved versions are locked in `package-lock.json`. MIT notices accompany the copied source.

Local compatibility fixes: corrected the loading-label import, removed invalid generated four-hyphen CSS aliases, constrained horizontal-axis labels to their reserved width, and mount the fixed-size donut after hydration because the upstream center checks browser custom-element availability during its first render. Analytics colors and layout are scoped to analytics. Report trend payloads now retain ISO bucket timestamps instead of reparsing formatted labels.

## Validation

`npm run build`, TypeScript and targeted ESLint checks. `scripts/check-bklit-analytics.mjs` authenticates locally and checks real-data metric changes, exact-values display, ranking selectors, chart hover, responsive widths down to 320px, reduced motion, a sales report and live pause. Screenshots are written to `.codex/analytics`. It does not modify order or customer records.

## Documentation inventory

- Area Chart: `docs/components/area-chart`
- Bar Chart: `docs/components/bar-chart`
- Candlestick Chart: `docs/components/candlestick-chart`
- Choropleth Chart: `docs/components/choropleth-chart`
- Composed Chart: `docs/components/composed-chart`
- Funnel Chart: `docs/components/funnel-chart`
- Gauge: `docs/components/gauge-chart`
- Heatmap Chart: `docs/components/heatmap-chart`
- Components: `docs/components/index`
- Line Chart: `docs/components/line-chart`
- Live Line Chart: `docs/components/live-line-chart`
- Pie Chart: `docs/components/pie-chart`
- Profit/Loss Line: `docs/components/profit-loss-line`
- Radar Chart: `docs/components/radar-chart`
- Ring Chart: `docs/components/ring-chart`
- Sankey Chart: `docs/components/sankey-chart`
- Scatter Chart: `docs/components/scatter-chart`
- Sunburst Chart: `docs/components/sunburst-chart`
- Introduction: `docs/index`
- Installation: `docs/installation`
- Skills: `docs/skills`
- Theming: `docs/theming`
- Axis: `docs/utility/axis/index`
- X Axis: `docs/utility/axis/x-axis`
- Y Axis: `docs/utility/axis/y-axis`
- Background: `docs/utility/background`
- Brush: `docs/utility/brush`
- Custom Indicator: `docs/utility/custom-indicator`
- Grid: `docs/utility/grid`
- Legend: `docs/utility/legend`
- Projection Line: `docs/utility/projection-line`
- Reference Area: `docs/utility/reference-area`
- Tooltip: `docs/utility/tooltip`
- useChart Hook: `docs/utility/use-chart`

## Gallery variant inventory

- **Area Chart**: Default area with gradient fill and smooth curve
- **Area Chart - Step**: Discrete step interpolation between points
- **Area Chart - Stacked**: Layered areas comparing desktop and mobile
- **Area Chart - Gradient**: Solid fill with gradientToOpacity control
- **Area Chart - No Stroke**: Softer look with the stroke line hidden
- **Area Chart - Fade Edges**: Area fill fades at the left and right edges
- **Area Chart - Loading**: Shimmering grid, pulsing foreground segment, and shimmer label while data loads
- **Area Chart - Loading (Sweep)**: Diagonal shimmer sweeping across the skeleton area while data loads
- **Area Chart - Segment Selection**: Click and drag to select a range
- **Area Chart - Pattern**: Diagonal line pattern fill instead of gradient
- **Area Chart - Series Markers**: Scatter-style ring markers at each point — same styling as Scatter
- **Area Chart - Dashed Tail**: Solid stroke through yesterday, dashed projection for the in-progress day
- **Area Chart - Left Y axis**: Both series share the left scale with explicit Y-axis labels
- **Area Chart - Left and right Y axes**: Independent left and right scales (biaxial)
- **Bar Chart**: Default vertical bar chart with rounded caps
- **Bar Chart - Loading**: Diagonal shimmer sweeping across placeholder bars while data loads
- **Bar Chart - 3D Depth**: Glass-block bars with perspective side + top faces and a custom line indicator
- **Bar Chart - 3D Stacked**: Stacked depth bars split into per-segment side faces
- **Bar Chart - Multiple Series**: Grouped bars comparing two metrics
- **Bar Chart - Stacked**: Stacked bars with gap between segments
- **Bar Chart - Horizontal**: Horizontal orientation with y-axis labels
- **Bar Chart - Dense Data**: 60 days of data with narrow gaps
- **Bar Chart - Gradient**: Linear gradient fill from blue to purple
- **Bar Chart - Shape & Gradient**: Discrete square columns with per-series gradient, diagonal column tracks, and ring crosshair indicators
- **Bar Chart - Shape Squircle Ring**: Fully rounded square columns with a squircle ring indicator snapped to each bar
- **Bar Chart - Pattern**: Diagonal line pattern fill
- **Bar Chart - No Gap**: Zero gap with gradient and animated line indicator
- **Bar Chart - Custom Tooltip**: Formatted currency values in tooltip
- **Bar Chart - Left Y axis**: Grouped vertical bars with a single left value scale and Y-axis labels
- **Bar Chart - Left and right Y axes**: Independent left and right value scales (biaxial)
- **Composed Chart — Bar + line**: 30 daily points with rounded SeriesBar tops (`radius`) and a smoothed revenue line
- **Composed Chart — Lime / amber / red**: Fixed hex accents (tailwind lime-300, amber-300, red-500) with rounded bars
- **Composed Chart — Stacked SeriesBar + line**: Two stack segments per day with the same 30-day timeline; stackGap={0} for flush stacks
- **Composed Chart — Grouped bars, no gap**: Two SeriesBar series per day with barGap={0}; rounded tops on both bar series
- **Composed Chart — Pattern fills**: One SeriesBar with a fuchsia-400 diagonal pattern, one solid bar on theme colors; revenue line unchanged
- **Composed Chart — Bar + two lines**: Installs as daily columns (rounded) with desktop and mobile lines (30-day variation)
- **Composed Chart — Markers & dashed tail**: Ring markers and a dashed projection on the run-rate line and area stroke
- **Composed Chart — Left Y axis**: Bars and line share one left value scale with Y-axis labels
- **Composed Chart — Left and right Y axes**: Units on the left scale, revenue line on the right (biaxial)
- **Composed Chart**: One time axis, one Y scale: combine SeriesBar, Line, and Area. Use the curve menu to swap the shared Line and Area interpolation.
- **Line Chart - Projection**: Target and auto forecasts with gradient dashed beziers and a terminal marker
- **Line Chart - Linear**: Straight lines between data points
- **Line Chart - Markers**: Custom markers to annotate key events
- **Line Chart - Segment Selection**: Click and drag to select a range
- **Line Chart - Multiple Lines**: Desktop vs mobile visitors over time
- **Line Chart - X Axis**: With labeled x-axis dates
- **Line Chart - X & Y Axis**: With both horizontal grid and x-axis labels
- **Line Chart - Series Markers**: Ring markers at each data point with the same config as Scatter
- **Line Chart - Loading**: Shimmering grid, pulsing foreground segment, and shimmer label while data loads
- **Line Chart - Loading (Sweep)**: Diagonal shimmer sweeping across the skeleton line while data loads
- **Line Chart - Dashed Tail**: Curved dashed segment from a chosen index — useful for incomplete periods
- **Line Chart - Left Y axis**: Both series on the left scale with explicit Y-axis tick labels
- **Line Chart - Left and right Y axes**: Independent left and right scales (biaxial)
- **Line Chart - Profit/Loss**: Sign-colored segments with a highlighted zero baseline and optional legend hover
- **Live Line Chart**: Streaming data with smooth scroll, live dot, and crosshair
- **Live Line - Now Offset**: Leading gap so the line fades at the right edge
- **Live Line - Momentum Colors**: Green for increase, red for decrease
- **Live Line - Line Only**: No area fill — simple line and live dot
- **Live Line - Pattern Background**: Diagonal pattern fill instead of grid lines
- **Live Line - Dot Grid Background**: Dot grid texture with edge fade
- **Live Line - Reference Band**: Target price band with dashed edges and bracket markers
- **Live Line - Pattern Reference Band**: Pattern fill inside the band with colored Y-axis ticks
- **Live Line Chart - Interactive**: Real-time streaming with crosshair and animated axes
- **Pie Chart**: Basic pie chart with colored slices
- **Pie Chart - Donut**: Hollow center with animated value display
- **Pie Chart - Legend**: Interactive legend synced with chart hover
- **Pie Chart - Patterns**: Diagonal line patterns for each slice
- **Pie Chart - Gradients**: Radial gradient fills on each slice
- **Pie Chart - Grow Hover**: Slices extend outward on hover instead of translating
- **Pie Chart - Custom Center**: Render prop for full control over center content
- **Donut Chart - Patterns**: Donut with patterned slices and center label
- **Donut Chart - Grow Hover**: Donut with grow effect and center value
- **Radar Chart**: Two models compared across five metrics
- **Radar Chart - Triangle**: Three metrics with two contrasting profiles
- **Radar Chart - Hexagon**: Six metrics, fill only without stroke or dots
- **Radar Chart - Single Series**: One asymmetric profile without corner dots
- **Radar Chart - Minimal**: No grid labels, fewer levels, clean look
- **Radar Chart - Grid Only**: No axis lines for a softer appearance
- **Ring Chart**: Multi-ring progress with center value
- **Ring Chart - Flat Caps**: Square ring ends instead of rounded
- **Ring Chart - Thick Rings**: Wider stroke with larger gap between rings
- **Ring Chart - Three Quarter**: 270-degree arc from top-left to bottom-left
- **Ring Chart - Half Circle**: 180-degree arc across the top
- **Ring Chart - Legend**: Interactive legend with progress bars
- **Gauge**: Notch arc with PieCenter-style NumberFlow, theme fills, optional patterns in defs, and separate active / inactive arc gradients when enabled.
- **Gauge — tight arc, filleted corners**: No spacing between notches, 7px corner radius, custom sweep from 140° to 400°.
- **Gauge — dual arc gradients**: Foreground and background notches each get their own hex ramp along the arc (requires useGradient).
- **Gauge — pattern foreground, dim solid track**: Diagonal PatternLines on active notches; inactive track uses `chart-1` at 0.4 fill opacity.
- **Gauge — sparse ring, quarter sweep**: Fewer notches, wide spacing, sharp corners, 90° → 270° sweep — reads like a progress ring segment.
- **Gauge — same density, bottom half sweep**: Same notch layout as the sparse ring example, but the arc runs 180° → 360° (lower semicircle emphasis).
- **Gauge — flipped sweep (270° → 450°)**: Same spacing and notch count as the quarter sweep, rotated so the gap sits on the opposite side of the ring.
- **Gauge — soft fillets, full depth**: Default notch length with an 8px corner radius — smooth joints without going fully pill-shaped.
- **Gauge — short notches, bold corners**: Radial depth at 38% with a 12px fillet — stubbier ticks that still read soft at the tips.
- **Gauge — near-circular notches**: Full default depth with a 22px corner radius (geometry-clamped) for a capsule / almost-round look.
- **Gauge — linear with label below**: Optional centerValue and labelPlacement for linear gauges — same placement model as chart legend.
- **Gauge — linear dual gradients**: Active and inactive notches each interpolate along their own hex ramp when useGradient is enabled.
- **Sankey Chart**: User flow with labels and tooltip
- **Sankey Chart - No Labels**: Compact diagram without node labels
- **Sankey Chart - Simple**: Minimal flow with fewer nodes
- **Sankey Chart - Solid Links**: Single-color links instead of gradients
- **Heatmap Chart**: GitHub-style contribution grid with axes and tooltip (six months)
- **Heatmap Chart - Pattern Levels**: Per-level pattern fills shared between chart and legend (six months)
- **Heatmap Chart - Solid Separators**: Calendar quarter separators with a flat solid stroke (six months)
- **Heatmap Chart - Compact Y Axis & Quarter Separators**: Mon / Wed / Fri labels, quarter separators with a vertical fade gradient (six months)
- **Heatmap Chart - Dashed Separators**: Quarter separators without a Y axis — dashed lines with vertical fade (six months)
- **Heatmap Chart - Loading**: Skeleton grid with cell shimmer while data loads (six months)
- **Heatmap Chart - Horizontal Scroll**: Scroll a full year of contributions with a viewport sized to six months
- **Heatmap Chart - Gradient Legend**: Continuous gradient bar legend with custom endpoint labels (six months)
- **Heatmap Chart - Monday Start**: Week starts on Monday with M–S labels and faded weekend rows (six months)
- **Heatmap Chart - Active Scale Hover**: Enlarge the hovered cell with a slightly larger gap (six months)
- **Choropleth Chart**: World map with single fill color and graticule
- **Choropleth Chart - Analytics**: Color scale based on visitor traffic by country
- **Choropleth Chart - Graticule**: Visible latitude and longitude grid lines
- **Choropleth Chart - Patterns**: Diagonal line patterns colored by region
- **Candlestick – Tooltip line matches candle**: Lime–emerald and yellow–red gradients. Crosshair color matches the focused candle (green/red); no dot.
- **Candlestick – Chart 1 & 3**: Using --chart-1 and --chart-3 for a stronger contrast
- **Candlestick – Lime to emerald, yellow to red**: Custom gradients: lime–emerald for up, yellow–red for down
- **Candlestick – Solid colors**: Solid emerald/red fills instead of gradients
- **Candlestick – Pattern**: Diagonal pattern overlay on candle bodies
- **Candlestick – Tooltip only**: Tooltip box without crosshair or dots
- **Candlestick Chart – Tooltip line matches candle**: Default palette (--chart-1 and --chart-5). The crosshair color follows the focused candle; no dot.
- **Profit/Loss Line**: Sign-colored segments with a highlighted zero baseline and legend hover
- **Profit/Loss Line - Left Y axis**: Sign-colored line with a left Y-axis scale and zero baseline
- **Line Chart - Trio with Brush**: Three Catmull–Rom series on a dot background with a top legend and brush zoom — matches the Studio trio preset.
- **Area Chart - Interactive**: Revenue vs costs over 30 days with segment selection. Use the curve menu to compare @visx/curve on both areas.
- **Bar Chart - Interactive**: Daily activity over the last 90 days
- **Sankey Chart - Interactive**: User flow from source to outcome
- **Heatmap Chart - Contributions**: Activity grid with circular cells, calendar quarter separators, compact day labels, and synced legend hover
- **Choropleth Chart - Interactive**: Visitor traffic by country
- **Funnel Chart**: Animated funnel chart with multi-layer halo rings, hover interactions, and an interactive legend.
- **Vertical**: Vertical orientation with top-to-bottom flow
- **Vertical Straight with Grid**: Combining vertical orientation, straight edges, and grid
- **Straight Edges**: Sharp geometric edges instead of smooth curves
- **Per-Segment Colors**: Each segment with its own color from the chart palette
- **Gradient Segments**: Linear gradients flowing between chart palette colors
- **Pattern Fill**: Diagonal line pattern on the innermost ring via renderPattern
- **Grouped Labels**: Labels stacked together in a compact group
- **Grid Background**: Alternating bands and grid lines for easier comparison
- **Scatter Chart - No Rings**: Solid fills only — set `strokeWidth={0}` to hide the outer ring
- **Scatter Chart - Small Dots**: Compact markers with a 2px radius and thin 1px rings
- **Scatter Chart - Wide Ring Gap**: 1px ring, 3px dot, 5px gap between fill and ring (`outlineWidth={0}`)
- **Scatter Chart - Left Y axis**: Both series share the left scale with Y-axis value labels
- **Scatter Chart - Left and right Y axes**: Independent left and right scales (biaxial)
- **Scatter Chart**: Desktop vs mobile over 24 months with default offset rings and crosshair tooltip
- **Sunburst Chart - Interactive**: Hierarchical revenue breakdown with drill-down zoom
- **Sunburst Chart - Patterns**: Diagonal stripes on alternating inner-ring segments (Product & Partners)
- **Sunburst Chart - Legend**: Legend synced to the current focus level and chart hover
