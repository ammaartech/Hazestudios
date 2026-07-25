/**
 * Turns an English reporting question into one read-only SQL statement, using
 * Google Gemini.
 *
 * Written to the same shape as `gemini.ts`: dependency-free, `fetch` against the
 * Generative Language REST API, no `@/` imports, so `scripts/verify-sql.mjs` can
 * exercise it from plain node without booting Next.
 *
 * The model is given the live schema (see `describeSchema`) rather than a
 * checked-in copy, plus the store's own conventions — a draft order is not a
 * sale, `partially_refunded` still counts as paid, product titles live in
 * `order_items.title_snapshot` because a deleted product nulls the FK. Without
 * those, the SQL parses and runs and quietly returns the wrong number, which is
 * worse than an error.
 *
 * Nothing here is trusted. Whatever comes back goes through
 * `assertReadOnlySql` and then a read-only transaction.
 */

/** Same stable Flash alias the product classifier uses — pinned versions get
 *  gated off for new keys and 404. Swap this one line to change models. */
const MODEL = "gemini-flash-latest";

export interface GeneratedQuery {
  /** A single SELECT / WITH statement. Unvalidated. */
  sql: string;
  /** Short title for the result panel, e.g. "Top products by revenue". */
  title: string;
  /** One or two sentences on what the query counts, shown under the title. */
  explanation: string;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    sql: { type: "string" },
    title: { type: "string" },
    explanation: { type: "string" },
  },
  required: ["sql", "title", "explanation"],
} as const;

/**
 * The conventions a correct answer depends on and the schema cannot express.
 *
 * Every rule here mirrors one already encoded in `lib/analytics/reports.ts`, so
 * an AI-built report and the matching catalog report agree on what a sale is.
 */
const BUSINESS_RULES = `
Store conventions — follow these exactly:

* Real orders always filter \`orders.is_draft = false\`. A draft order is an
  unfinished order sitting in the admin, not a sale.
* "Paid", "sold", "revenue" and "sales" mean
  \`orders.payment_status in ('paid', 'partially_refunded')\`. A partial refund
  is still a sale. Use this filter for any money figure.
* Order counts that are not about money may include every non-draft order
  regardless of payment_status. Say which you used in the explanation.
* Product-level sales come from \`order_items\` joined to \`orders\` on
  \`order_items.order_id = orders.id\`, and are filtered by
  \`orders.created_at\`, never by any column on order_items.
* Name products in sales reports with \`order_items.title_snapshot\`, not by
  joining \`products\`. \`order_items.product_id\` is nulled when a product is
  deleted, so a join drops historical sales.
* Units sold is \`sum(order_items.quantity)\`. Revenue for a line is
  \`sum(order_items.price_snapshot * order_items.quantity)\`.
* Order-level money is \`orders.total\` (also subtotal, discount_total).
  All money columns are numeric(12,2) — do not divide by 100.
* Storefront traffic lives in \`analytics_sessions\` (one row per visit, use
  \`started_at\`) and \`analytics_events\` (one row per action, use
  \`created_at\` and \`type\`). Sessions are not customers.
* Stock is \`inventory_levels.quantity\`, held per location — always
  \`sum(quantity)\` grouped by product, never a bare select.
* A customer's display name is
  \`nullif(trim(c.first_name || ' ' || c.last_name), '')\`, falling back to
  \`c.email\`, then 'Unknown'. Both name parts default to '' and may be blank.
* \`orders.customer_id\` is nullable — use a left join and label the gap
  'No customer' when counting orders by customer.
`.trim();

const SQL_RULES = `
Output rules — a query that breaks one of these is rejected unrun:

* Exactly one statement. No semicolon. SELECT or WITH only.
* Read-only. No INSERT, UPDATE, DELETE, DDL, SET, or CALL.
* Only the tables listed in the schema above. Never the auth, storage, vault or
  pg_catalog schemas, and no pg_* function.
* Inline every value as a literal. Never emit $1 placeholders.
* Alias every output column to a human-readable label in double quotes —
  \`sum(oi.quantity) as "Units sold"\`. These become the report's column
  headers, so no snake_case and no bare \`count\`.
* Put the label column first, then the numbers, in the order a reader wants
  them.
* Never return a raw date or timestamp as an output column. Format it as text:
  \`to_char(date_trunc('day', o.created_at), 'YYYY-MM-DD') as "Date"\`, or
  \`'YYYY-MM'\` for a month. The session runs in the store's timezone, so
  date_trunc already buckets by the merchant's day.
* The table does not add a currency symbol, so put the currency in the label of
  a money column — \`as "Revenue (CURRENCY)"\`. Never on a plain count.
* Any "top", "best", "highest", "worst" or "most" question needs an explicit
  ORDER BY on the ranking column plus a LIMIT. Default to LIMIT 20 when the
  question gives no number.
* Always end with a LIMIT. Use 200 as the ceiling for a plain listing.
* Round money and averages to 2 decimals with \`round(x::numeric, 2)\`.
* Match text loosely with ILIKE and '%...%', never '=' — a shopper's spelling
  and a product title rarely agree exactly.
* Exclude nothing else. Do not silently add filters the question did not ask
  for, beyond the store conventions above.
`.trim();

export interface SqlContext {
  /** Introspected DDL summary from `describeSchema()`. */
  schema: string;
  /** YYYY-MM-DD in the store's timezone. */
  today: string;
  /** IANA name, e.g. "America/Toronto". */
  timezone: string;
  /** ISO code from shop_settings, used to label money columns. */
  currency: string;
}

function systemPrompt(ctx: SqlContext): string {
  const { schema, today, timezone, currency } = ctx;

  return [
    "You write PostgreSQL 15 read-only queries for the admin analytics screen of",
    "an e-commerce store. You are given a question in English and you return one",
    "SQL statement that answers it, a short title, and a plain-English",
    "explanation of what the query counts.",
    "",
    `Today's date is ${today}. The store's timezone is ${timezone}, and it sells`,
    `in ${currency} — use that code where the rules below ask for a currency.`,
    "Timestamps are all `timestamptz`. Interpret relative dates like \"today\",",
    "\"this month\" or \"last 30 days\" against that date. Read an ambiguous",
    "numeric date as day/month/year — 1/06/2026 is 1 June 2026. When the",
    "question names an end date, include the whole of that day by comparing",
    "`< end_date + interval '1 day'` rather than `<= end_date`.",
    "",
    "Database schema (live, authoritative — do not use a column that is not here):",
    schema,
    "",
    BUSINESS_RULES,
    "",
    SQL_RULES,
    "",
    "If the question cannot be answered from this schema, return a query of",
    "`select 'Not answerable from the store data' as \"Result\" limit 1` and say",
    "why in the explanation. Never guess at a table or column that is not listed.",
  ].join("\n");
}

export function textToSqlConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function generate(key: string, body: unknown): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  // One retry on the transient capacity/quota codes; anything else surfaces.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok || (res.status !== 429 && res.status !== 503) || attempt === 1) {
      return res;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error("unreachable");
}

/** Strips a ```sql fence, which the model adds occasionally despite the JSON
 *  response schema. */
function unfence(sql: string): string {
  const fenced = /^\s*```(?:sql)?\s*([\s\S]*?)\s*```\s*$/i.exec(sql);
  return (fenced ? fenced[1] : sql).trim();
}

/**
 * Asks Gemini for a query. Returns null when nothing usable came back — no key,
 * a blocked or empty response, unparseable JSON — so the caller maps every
 * failure to one message instead of leaking model plumbing into the UI.
 */
export async function questionToSql(
  question: string,
  context: SqlContext
): Promise<GeneratedQuery | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt(context) }] },
    contents: [{ parts: [{ text: question }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      // Reporting SQL should be the same query every time the same question is
      // asked; there is no upside to sampling here.
      temperature: 0,
      // No thinkingConfig: Gemini 3.x rejects thinkingBudget, and the default
      // budget is what gets the joins right on a schema this size.
    },
  };

  let json: {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  try {
    const res = await generate(key, body);
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }

  // Thinking models can return several parts; the JSON payload is the last one
  // with text, not necessarily the first.
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = [...parts].reverse().find((p) => p.text)?.text;
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as Partial<GeneratedQuery>;
    const sql = typeof parsed.sql === "string" ? unfence(parsed.sql) : "";
    if (!sql) return null;

    return {
      sql,
      title:
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim()
          : "Report",
      explanation:
        typeof parsed.explanation === "string" ? parsed.explanation.trim() : "",
    };
  } catch {
    return null;
  }
}
