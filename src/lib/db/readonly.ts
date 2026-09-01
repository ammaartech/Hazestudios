/**
 * A deliberately read-only Postgres connection, used only by the natural-language
 * report builder in Analytics → Reports.
 *
 * Everything else in the app talks to Postgres through PostgREST (the Supabase
 * client), where RLS is the boundary. Ad-hoc reporting cannot work that way: the
 * whole point is to run a SQL statement nobody wrote ahead of time, and PostgREST
 * has no endpoint for that. So this module opens a direct connection with
 * `SUPABASE_DB_URL` — the same credential `npm run db:migrate` uses.
 *
 * That credential is the project owner, so it bypasses RLS and could in
 * principle write. Three independent things stop it, and the order matters:
 *
 *   1. `runReadOnlyQuery` wraps every statement in `BEGIN TRANSACTION READ ONLY`
 *      and always rolls back. This is the real boundary, enforced by Postgres
 *      itself rather than by string matching — an INSERT, a DDL statement, or a
 *      SECURITY DEFINER function that deletes rows (`prune_analytics()`) all
 *      fail with "cannot execute ... in a read-only transaction" no matter how
 *      they were smuggled in.
 *   2. The statement is nested inside `select * from ( ... ) limit n`, which is
 *      a grammatical position where only a SELECT is legal. Postgres rejects
 *      data-modifying CTEs outside a top-level statement, so `with x as (delete
 *      ...) select * from x` is a syntax error here.
 *   3. `assertReadOnlySql` in sql-guard.ts screens the text before it ever gets
 *      here, so the common cases fail with a readable message instead of a
 *      Postgres error.
 *
 * A statement timeout and a row cap keep a careless question from pinning the
 * database or streaming a million rows into a React tree.
 */

import { Pool, type PoolClient } from "pg";

/** Long enough for an unindexed aggregate over the order tables, short enough
 *  that a runaway join gives up before the request does. */
const STATEMENT_TIMEOUT_MS = 10_000;

/** Hard ceiling on returned rows. Reports are read on screen and exported to
 *  CSV; past a few thousand rows both stop being useful. */
export const MAX_ROWS = 1_000;

/* -------------------------------------------------------------------------- */
/* Connection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Splits a Postgres URI without going through the URL parser.
 *
 * Mirrors `scripts/db-config.mjs`, and for the same reason: Supabase hands you a
 * URI with the password inlined *unencoded*, and those passwords routinely
 * contain `@` and `#`. A strict parser either throws or silently truncates the
 * password, which then surfaces as "password authentication failed" and sends
 * you looking in the wrong place. Split on the LAST `@` — a hostname cannot
 * contain one — and on the FIRST `:` of the userinfo.
 *
 * Kept as a copy rather than a shared import: that file is a plain `.mjs`
 * script with a `readFileSync` of `.env.local` at import time, which has no
 * business running inside the Next server.
 */
function parseConnectionString(raw: string) {
  const withoutScheme = raw.replace(/^postgres(ql)?:\/\//, "");
  if (withoutScheme === raw) {
    throw new Error("SUPABASE_DB_URL must start with postgresql:// or postgres://");
  }

  const [beforeQuery] = withoutScheme.split("?");

  const lastAt = beforeQuery.lastIndexOf("@");
  if (lastAt < 0) {
    throw new Error("SUPABASE_DB_URL has no '@' separating credentials from host");
  }

  const userinfo = beforeQuery.slice(0, lastAt);
  const hostPart = beforeQuery.slice(lastAt + 1);

  const firstColon = userinfo.indexOf(":");
  if (firstColon < 0) {
    throw new Error("SUPABASE_DB_URL has no password (expected user:password@host)");
  }
  const user = userinfo.slice(0, firstColon);
  const rawPassword = userinfo.slice(firstColon + 1);

  // A correctly percent-encoded password gets decoded; one pasted raw stays
  // raw, since decodeURIComponent throws on a stray '%'.
  let password = rawPassword;
  if (/%[0-9a-f]{2}/i.test(rawPassword)) {
    try {
      password = decodeURIComponent(rawPassword);
    } catch {
      /* not valid encoding — treat as literal */
    }
  }

  const slash = hostPart.indexOf("/");
  const hostPort = slash < 0 ? hostPart : hostPart.slice(0, slash);
  const database = slash < 0 ? "postgres" : hostPart.slice(slash + 1) || "postgres";

  const colon = hostPort.lastIndexOf(":");
  const host = colon < 0 ? hostPort : hostPort.slice(0, colon);
  const port = colon < 0 ? 5432 : Number(hostPort.slice(colon + 1));

  if (!host) throw new Error("SUPABASE_DB_URL has no host");
  if (!Number.isFinite(port)) throw new Error("SUPABASE_DB_URL has a non-numeric port");
  if (!password) throw new Error("SUPABASE_DB_URL has an empty password");

  return { user, password, host, port, database };
}

export function readOnlyDbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_DB_URL);
}

/**
 * One pool per process, stashed on `globalThis` so a dev-server hot reload
 * re-uses it instead of leaking a new pool per edit.
 */
const globalForPool = globalThis as typeof globalThis & {
  hazeReportPool?: Pool;
};

function getPool(): Pool {
  if (globalForPool.hazeReportPool) return globalForPool.hazeReportPool;

  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) throw new Error("SUPABASE_DB_URL is not set");

  const pool = new Pool({
    ...parseConnectionString(raw),
    // Supabase terminates TLS with a chain this client has no root for. The
    // connection is still encrypted; only chain verification is relaxed.
    ssl: { rejectUnauthorized: false },
    // This backs one admin screen used by a handful of staff, so a wide pool
    // would only hold Supabase connections open for nothing.
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Without a listener, a backend terminated between checkouts becomes an
  // unhandled 'error' event and takes the server process down.
  pool.on("error", () => {});

  globalForPool.hazeReportPool = pool;
  return pool;
}

/* -------------------------------------------------------------------------- */
/* Result shaping                                                              */
/* -------------------------------------------------------------------------- */

/** How a column should be rendered. Derived from the pg type OID, because the
 *  UI wants numbers right-aligned and timestamps formatted, and the values
 *  themselves arrive as strings either way. */
export type ColumnKind = "number" | "date" | "boolean" | "text";

export interface QueryColumn {
  name: string;
  kind: ColumnKind;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: (string | number | boolean | null)[][];
  /** True when the row cap clipped the result. */
  truncated: boolean;
}

// From pg_type.oid. Only the types this schema actually produces.
const NUMBER_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700]);
const DATE_OIDS = new Set([1082, 1114, 1184]);
const BOOLEAN_OIDS = new Set([16]);

function kindOf(oid: number): ColumnKind {
  if (NUMBER_OIDS.has(oid)) return "number";
  if (DATE_OIDS.has(oid)) return "date";
  if (BOOLEAN_OIDS.has(oid)) return "boolean";
  return "text";
}

/** Two digits, for the date formatter below. */
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Renders a timestamp using the connection's own calendar rather than an ISO
 * string.
 *
 * node-postgres turns a `timestamptz` into a JS `Date` — an absolute instant —
 * and the session time zone that produced it is already set to the store's (see
 * `runReadOnlyQuery`). Handing an ISO string to the browser would convert it a
 * second time, into whatever zone the viewer happens to sit in, and a bucket
 * labelled "1 June" would render as 31 May for anyone west of the store. So the
 * date is flattened here, once, and the client prints it verbatim.
 *
 * Queries are asked to emit `to_char(...)` text for date columns anyway; this is
 * the fallback for when the model returns a bare timestamp.
 */
function formatTimestamp(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const midnight =
    date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  return midnight ? day : `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Flattens a pg value into something a Server Action can hand to the client.
 *
 * `numeric` arrives as a string so that arbitrary precision survives the wire.
 * Every money column here is `numeric(12,2)`, which is far inside the range a
 * double represents exactly, so converting is safe and lets the table align the
 * column and the CSV export carry a real number.
 */
function serialize(
  value: unknown,
  kind: ColumnKind
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return formatTimestamp(value);

  if (kind === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : String(value);
  }
  if (kind === "boolean") return Boolean(value);
  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Runs one SELECT inside a read-only transaction and rolls it back.
 *
 * `sql` must already have been through `assertReadOnlySql`. It is nested in a
 * subquery here, which both applies the row cap and removes any grammatical
 * room for a statement that is not a SELECT.
 *
 * `timezone` is the store's, from `shop_settings`. It decides where a day
 * begins, so `date_trunc('day', created_at)` buckets an order into the day the
 * merchant made the sale rather than the day UTC agrees with.
 */
export async function runReadOnlyQuery(
  sql: string,
  timezone?: string
): Promise<QueryResult> {
  // One extra row, purely to detect that the cap was hit.
  //
  // The inner ORDER BY survives the wrap. Postgres makes no formal promise that
  // a subquery's ordering is preserved, but nothing above it here reorders —
  // no join, no aggregate, no outer sort — so the plan passes the subplan's rows
  // straight through. Worth knowing: the alternative, capping rows in JS after
  // the fact, would mean pulling an unbounded result into memory first.
  const wrapped = `select * from (\n${sql}\n) as ai_report limit ${MAX_ROWS + 1}`;

  return withClient(async (client) => {
    await client.query("begin transaction read only");
    try {
      // set_config with is_local = true is SET LOCAL, but parameterised — SET
      // itself takes no bind values, and these would otherwise be interpolated.
      await client.query("select set_config($1, $2, true)", [
        "statement_timeout",
        String(STATEMENT_TIMEOUT_MS),
      ]);
      if (timezone) {
        await client.query("select set_config($1, $2, true)", ["timezone", timezone]);
      }

      // rowMode 'array' keeps column order and survives a query that selects
      // two columns of the same name — object mode would silently drop one.
      const result = await client.query({ text: wrapped, rowMode: "array" });

      const columns: QueryColumn[] = result.fields.map((f) => ({
        name: f.name,
        kind: kindOf(f.dataTypeID),
      }));

      const raw = result.rows as unknown[][];
      const truncated = raw.length > MAX_ROWS;
      const rows = (truncated ? raw.slice(0, MAX_ROWS) : raw).map((row) =>
        row.map((cell, i) => serialize(cell, columns[i]?.kind ?? "text"))
      );

      return { columns, rows, truncated };
    } finally {
      // Nothing to commit — a read-only transaction is rolled back either way,
      // and doing it in `finally` means a failed statement still leaves the
      // pooled connection clean for the next checkout.
      await client.query("rollback").catch(() => {});
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Schema introspection                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The schema text handed to the model, read from the live database.
 *
 * Introspected rather than hand-written: this schema is thirteen migrations deep
 * and still moving (`products` alone has gained columns in 0005, 0008 and 0009).
 * A checked-in copy would drift, and a drifted schema makes the model invent
 * column names — the one failure mode that looks like a working feature.
 */
let schemaCache: { text: string; at: number } | null = null;
const SCHEMA_TTL_MS = 10 * 60 * 1000;

const COLUMNS_SQL = `
  select c.relname as tbl,
         a.attname as col,
         format_type(a.atttypid, a.atttypmod) as typ
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  where n.nspname = 'public'
    and c.relkind in ('r', 'v', 'm')
    and a.attnum > 0
    and not a.attisdropped
    and c.relname not like '\\_%'
  order by c.relname, a.attnum
`;

const ENUMS_SQL = `
  select t.typname as name,
         string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) as labels
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname
  order by t.typname
`;

// Single-column foreign keys only. Composite keys would need conkey unnested in
// order, and this schema has none worth the extra SQL.
const KEYS_SQL = `
  select src.relname as tbl,
         sa.attname  as col,
         tgt.relname as ref_tbl,
         ta.attname  as ref_col
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace n on n.oid = src.relnamespace
  join pg_attribute sa on sa.attrelid = con.conrelid and sa.attnum = con.conkey[1]
  join pg_attribute ta on ta.attrelid = con.confrelid and ta.attnum = con.confkey[1]
  where con.contype = 'f'
    and n.nspname = 'public'
    and array_length(con.conkey, 1) = 1
  order by src.relname, sa.attname
`;

export async function describeSchema(): Promise<string> {
  if (schemaCache && Date.now() - schemaCache.at < SCHEMA_TTL_MS) {
    return schemaCache.text;
  }

  const text = await withClient(async (client) => {
    await client.query("begin transaction read only");
    try {
      // Sequential, not Promise.all: these share one pooled client, and a
      // single pg client can only have one query in flight — overlapping them
      // is deprecated in pg 8 and an error in pg 9.
      const cols = await client.query<{ tbl: string; col: string; typ: string }>(
        COLUMNS_SQL
      );
      const enums = await client.query<{ name: string; labels: string }>(ENUMS_SQL);
      const keys = await client.query<{
        tbl: string;
        col: string;
        ref_tbl: string;
        ref_col: string;
      }>(KEYS_SQL);

      const byTable = new Map<string, string[]>();
      for (const r of cols.rows) {
        const list = byTable.get(r.tbl) ?? [];
        list.push(`${r.col} ${r.typ}`);
        byTable.set(r.tbl, list);
      }

      const lines: string[] = [];
      for (const [table, columns] of byTable) {
        lines.push(`${table}(${columns.join(", ")})`);
      }

      if (enums.rows.length) {
        lines.push("");
        lines.push("Enum types:");
        for (const e of enums.rows) lines.push(`  ${e.name}: ${e.labels}`);
      }

      if (keys.rows.length) {
        lines.push("");
        lines.push("Foreign keys:");
        for (const k of keys.rows) {
          lines.push(`  ${k.tbl}.${k.col} -> ${k.ref_tbl}.${k.ref_col}`);
        }
      }

      return lines.join("\n");
    } finally {
      await client.query("rollback").catch(() => {});
    }
  });

  schemaCache = { text, at: Date.now() };
  return text;
}
