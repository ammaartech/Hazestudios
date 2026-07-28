"use server";

import { createClient } from "@/lib/supabase/server";
import { questionToSql, textToSqlConfigured } from "@/lib/ai/text-to-sql";
import { assertReadOnlySql, SqlGuardError } from "@/lib/analytics/sql-guard";
import {
  describeSchema,
  readOnlyDbConfigured,
  runReadOnlyQuery,
  MAX_ROWS,
  type QueryColumn,
} from "@/lib/db/readonly";

/**
 * "Ask for a report" — the natural-language half of the report catalog.
 *
 * A Server Action is a public POST endpoint, so this gates on `is_staff()`
 * before spending a model call or opening a database connection, exactly as
 * `products/ai-actions.ts` does. The hidden panel in the admin is a hint, not
 * the boundary.
 *
 * Order matters: cheap local checks, then the staff gate, then Gemini, then the
 * guard, then a read-only transaction. Nothing the model returns is trusted —
 * see `lib/analytics/sql-guard.ts` and `lib/db/readonly.ts` for the layers.
 *
 * Every failure returns a typed reason rather than throwing, because this sits
 * beside the working report catalog and must never take the page down.
 */

const MAX_QUESTION_LENGTH = 500;

export interface AskSuccess {
  ok: true;
  title: string;
  explanation: string;
  /** The exact statement that ran, after comment stripping. Shown in the UI —
   *  a report nobody can audit is a report nobody should trust. */
  sql: string;
  columns: QueryColumn[];
  rows: (string | number | boolean | null)[][];
  truncated: boolean;
  maxRows: number;
}

export interface AskFailure {
  ok: false;
  reason:
    | "empty"
    | "too-long"
    | "not-configured"
    | "unauthorized"
    | "model-failed"
    | "rejected"
    | "query-failed";
  message: string;
  /** Present when a query was produced but rejected or failed, so the admin can
   *  see what went wrong instead of guessing. */
  sql?: string;
}

export type AskResult = AskSuccess | AskFailure;

/** The schema's own default, used when shop_settings has nothing usable. */
const FALLBACK_TIMEZONE = "America/Toronto";

/**
 * Keeps an unusable `shop_settings.timezone` from reaching Postgres.
 *
 * `set_config('timezone', ...)` throws on a name Postgres does not know, and
 * that happens inside the report transaction — one bad settings row would break
 * every query rather than one. Intl and Postgres both take IANA names, so Intl
 * is a usable pre-flight check.
 */
function resolveTimezone(value: string | null | undefined): string {
  if (!value) return FALLBACK_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

/** Today's date in the store's own timezone — "sales today" has to mean the
 *  merchant's today, not the server's UTC one. */
function todayIn(timezone: string): string {
  // en-CA gives YYYY-MM-DD, which is the format the prompt asks the model for.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function askForReport(question: string): Promise<AskResult> {
  const trimmed = (question ?? "").trim();

  if (!trimmed) {
    return { ok: false, reason: "empty", message: "Type a question first." };
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return {
      ok: false,
      reason: "too-long",
      message: `Keep the question under ${MAX_QUESTION_LENGTH} characters.`,
    };
  }

  if (!textToSqlConfigured() || !readOnlyDbConfigured()) {
    return {
      ok: false,
      reason: "not-configured",
      message:
        "AI reports aren't set up on this store yet — GEMINI_API_KEY and SUPABASE_DB_URL are both required.",
    };
  }

  // Staff gate, before any spend. The admin shell blocks non-staff at the
  // route, but this endpoint is reachable directly.
  let timezone = FALLBACK_TIMEZONE;
  let currency = "INR";
  try {
    const supabase = await createClient();
    const { data: isStaff } = await supabase.rpc("is_staff");
    if (!isStaff) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "You do not have permission to run reports.",
      };
    }

    const { data: settings } = await supabase
      .from("shop_settings")
      .select("timezone, currency")
      .single();
    timezone = resolveTimezone(settings?.timezone);
    if (settings?.currency) currency = settings.currency;
  } catch {
    return {
      ok: false,
      reason: "unauthorized",
      message: "Could not verify your session. Try again.",
    };
  }

  // Schema comes from the live database so the model never sees a stale column
  // list. Cached in-process for ten minutes.
  let schema: string;
  try {
    schema = await describeSchema();
  } catch {
    return {
      ok: false,
      reason: "query-failed",
      message: "Could not reach the reporting database. Try again in a moment.",
    };
  }

  const generated = await questionToSql(trimmed, {
    schema,
    today: todayIn(timezone),
    timezone,
    currency,
  });

  if (!generated) {
    return {
      ok: false,
      reason: "model-failed",
      message:
        "Couldn't turn that into a query. Try naming the metric and the date range explicitly.",
    };
  }

  let sql: string;
  try {
    sql = assertReadOnlySql(generated.sql);
  } catch (error) {
    return {
      ok: false,
      reason: "rejected",
      message:
        error instanceof SqlGuardError
          ? error.message
          : "That question produced a query this tool will not run.",
      sql: generated.sql,
    };
  }

  try {
    const result = await runReadOnlyQuery(sql, timezone);
    return {
      ok: true,
      title: generated.title,
      explanation: generated.explanation,
      sql,
      columns: result.columns,
      rows: result.rows,
      truncated: result.truncated,
      maxRows: MAX_ROWS,
    };
  } catch (error) {
    // The Postgres message is the single most useful thing here, and this screen
    // is staff-only, so it is shown rather than swallowed. A statement timeout
    // gets its own wording because "canceling statement" reads like a bug.
    const raw = error instanceof Error ? error.message : "Unknown error";
    const timedOut = /statement timeout|canceling statement/i.test(raw);

    return {
      ok: false,
      reason: "query-failed",
      message: timedOut
        ? "That query took too long and was stopped. Try a narrower date range."
        : `The database rejected the query: ${raw}`,
      sql,
    };
  }
}
