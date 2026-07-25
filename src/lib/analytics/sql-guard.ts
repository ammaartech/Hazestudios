/**
 * Screening for model-generated SQL, before `runReadOnlyQuery` executes it.
 *
 * This is the outermost of three layers, and the weakest by design — the real
 * boundary is the read-only transaction in `lib/db/readonly.ts`, which Postgres
 * enforces regardless of what the text says. What this adds is (a) a readable
 * error instead of a Postgres one, and (b) cover for the things a read-only
 * transaction happily permits: reading `auth.users`, dumping a catalog, or
 * reaching a filesystem-adjacent function.
 *
 * The checks run against a *projection* of the statement rather than the raw
 * text. `scan()` strips comments and blanks out string literals first, so a
 * block comment spliced into the middle of a keyword cannot carry it past a
 * word-boundary regex, and a customer note reading 'please delete this' cannot
 * trip one. The comment-stripped text is also what gets executed, so the string
 * that was checked and the string that runs are always the same string.
 */

/** Bounds the statement so the wrapped query stays a sane size. */
const MAX_SQL_LENGTH = 8_000;

export class SqlGuardError extends Error {}

/* -------------------------------------------------------------------------- */
/* Lexing                                                                      */
/* -------------------------------------------------------------------------- */

interface Scanned {
  /** Comments removed, literals intact. This is what gets executed. */
  sql: string;
  /**
   * Comments removed; string literals AND quoted identifiers blanked. Used for
   * the keyword rules, so that a column aliased `"Order Comment"` is not read
   * as the COMMENT statement.
   */
  code: string;
  /**
   * As `code`, but with quoted identifiers left visible and unquoted. Used for
   * the schema and system-object rules, where `"auth"."users"` has to be caught
   * as readily as `auth.users`.
   */
  refs: string;
  /** Count of `;` found outside any literal or comment. */
  semicolons: number;
  /** True when a `;` is followed by anything other than whitespace. */
  hasTrailingStatement: boolean;
}

/**
 * Walks the statement once, tracking Postgres' four quoting forms so that
 * comment stripping and `;` detection are accurate.
 *
 * Dollar quoting matters here: `$tag$ ... $tag$` is how a body containing
 * quotes gets written, and a scanner that missed it would treat the contents as
 * code. Block comments nest in Postgres, so the depth is counted.
 */
function scan(input: string): Scanned {
  let sql = "";
  let code = "";
  let refs = "";
  let semicolons = 0;
  let hasTrailingStatement = false;

  /** Appends to every projection at once — for ordinary, unquoted characters. */
  const push = (text: string) => {
    sql += text;
    code += text;
    refs += text;
  };

  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];
    const next = input[i + 1];

    // -- line comment
    if (ch === "-" && next === "-") {
      while (i < n && input[i] !== "\n") i++;
      // Keep the newline so tokens either side do not fuse together.
      continue;
    }

    // /* block comment */, nestable
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (input[i] === "/" && input[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (input[i] === "*" && input[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      // A comment separates tokens; leave a space where it was.
      push(" ");
      continue;
    }

    // 'single quoted literal', '' escapes a quote
    if (ch === "'") {
      let literal = "'";
      i++;
      while (i < n) {
        if (input[i] === "'" && input[i + 1] === "'") {
          literal += "''";
          i += 2;
        } else if (input[i] === "'") {
          literal += "'";
          i++;
          break;
        } else {
          literal += input[i];
          i++;
        }
      }
      sql += literal;
      // Blanked in both projections — data must never be read as code.
      code += "''";
      refs += "''";
      continue;
    }

    // "quoted identifier", "" escapes a quote
    if (ch === '"') {
      let ident = '"';
      i++;
      while (i < n) {
        if (input[i] === '"' && input[i + 1] === '"') {
          ident += '""';
          i += 2;
        } else if (input[i] === '"') {
          ident += '"';
          i++;
          break;
        } else {
          ident += input[i];
          i++;
        }
      }
      sql += ident;
      // A quoted identifier is never parsed as a keyword, so it is blanked for
      // the keyword rules — otherwise a column aliased "Order Comment" would be
      // rejected. It stays visible in `refs`, where it can still name a table.
      code += ' "" ';
      refs += " " + ident.slice(1, -1).replace(/""/g, '"') + " ";
      continue;
    }

    // $tag$ dollar quoted literal $tag$
    const dollar = ch === "$" ? /^\$[A-Za-z_]?\w*\$/.exec(input.slice(i)) : null;
    if (dollar) {
      const tag = dollar[0];
      const end = input.indexOf(tag, i + tag.length);
      const stop = end < 0 ? n : end + tag.length;
      sql += input.slice(i, stop);
      code += "''";
      refs += "''";
      i = stop;
      continue;
    }

    if (ch === ";") {
      semicolons++;
      if (input.slice(i + 1).trim() !== "") hasTrailingStatement = true;
      // Dropped from the executable text — the statement gets wrapped anyway.
      push(" ");
      i++;
      continue;
    }

    push(ch);
    i++;
  }

  return {
    sql: sql.trim(),
    code: code.toLowerCase(),
    refs: refs.toLowerCase(),
    semicolons,
    hasTrailingStatement,
  };
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Statement types that must never appear. Most are already impossible — the
 * statement is nested in `select * from ( ... )`, where only a SELECT parses —
 * but naming them turns a syntax error into an explanation.
 *
 * `fetch` is deliberately absent: `fetch first n rows only` is ordinary SELECT
 * syntax, and cursor FETCH needs a DECLARE that is blocked here.
 */
const FORBIDDEN_KEYWORDS = [
  "insert", "update", "delete", "truncate", "merge", "upsert",
  "drop", "alter", "create", "grant", "revoke", "comment", "reindex",
  "cluster", "vacuum", "analyze", "explain", "refresh", "import", "load",
  "copy", "call", "do", "declare", "prepare", "execute", "deallocate",
  "discard", "listen", "unlisten", "notify", "lock", "checkpoint",
  "begin", "start", "commit", "rollback", "savepoint", "release",
  "set", "reset", "into",
];

/**
 * Non-`pg_` functions with side effects, remote reach, or nested execution.
 * `query_to_xml` and the `*_to_xml` family are the sharp ones: they take SQL as
 * a string argument and run it, which would step around every check above.
 */
const FORBIDDEN_FUNCTIONS = [
  "dblink", "dblink_exec", "dblink_connect", "dblink_send_query",
  "lo_import", "lo_export", "lo_get", "lo_put", "lo_unlink",
  "set_config", "current_setting",
  "query_to_xml", "table_to_xml", "schema_to_xml", "database_to_xml",
  "query_to_xmlschema", "cursor_to_xml",
  // The project's own SECURITY DEFINER helpers. Both are already stopped by the
  // read-only transaction; listed so the failure names itself.
  "prune_analytics", "save_product",
];

/**
 * Schemas that hold credentials, platform internals, or catalog metadata.
 * `auth` is the important one — `auth.users` carries every customer's email and
 * encrypted password, and a read-only transaction has no objection to reading it.
 */
const FORBIDDEN_SCHEMAS = [
  "auth", "vault", "storage", "extensions", "cron", "net", "realtime",
  "graphql", "graphql_public", "supabase_functions", "supabase_migrations",
  "information_schema", "pg_catalog", "pg_temp", "pg_toast",
];

const word = (w: string) => new RegExp(`\\b${w}\\b`);

/**
 * Validates a model-generated statement and returns the exact SQL to execute.
 *
 * Throws `SqlGuardError` with a message meant for the admin UI. The returned
 * string is the comment-stripped form that every check was run against.
 */
export function assertReadOnlySql(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    throw new SqlGuardError("No SQL was produced for that question.");
  }
  if (trimmed.length > MAX_SQL_LENGTH) {
    throw new SqlGuardError(
      `That question produced an unusually long query (${trimmed.length} characters). Try asking something narrower.`
    );
  }

  const { sql, code, refs, semicolons, hasTrailingStatement } = scan(trimmed);

  if (!sql) {
    throw new SqlGuardError("No SQL was produced for that question.");
  }
  if (semicolons > 1 || hasTrailingStatement) {
    throw new SqlGuardError(
      "Only a single statement can be run. This query contained more than one."
    );
  }

  // A leading paren is legal — `(select ...) union (select ...)`.
  if (!/^\(*\s*(select|with|table|values)\b/.test(code)) {
    throw new SqlGuardError(
      "Only read queries are allowed. This one did not begin with SELECT or WITH."
    );
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (word(keyword).test(code)) {
      throw new SqlGuardError(
        `Only read queries are allowed — "${keyword.toUpperCase()}" is not permitted.`
      );
    }
  }

  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (word(fn).test(refs)) {
      throw new SqlGuardError(`The function "${fn}" is not available to reports.`);
    }
  }

  // Every `pg_*` catalog and system function in one rule. No report over this
  // schema has any reason to touch one, and the prefix covers pg_sleep,
  // pg_read_file, pg_authid and the rest without enumerating them.
  const pgSymbol = /\bpg_\w+/.exec(refs);
  if (pgSymbol) {
    throw new SqlGuardError(
      `System objects are not available to reports ("${pgSymbol[0]}").`
    );
  }

  for (const schema of FORBIDDEN_SCHEMAS) {
    if (new RegExp(`\\b${schema}\\s*\\.`).test(refs)) {
      throw new SqlGuardError(
        `Reports can only read the store's own tables — the "${schema}" schema is off limits.`
      );
    }
  }

  // Placeholders would fail at bind time with an opaque error; the model is
  // asked to inline its literals instead.
  if (/\$\d/.test(code)) {
    throw new SqlGuardError(
      "The query used bind placeholders instead of literal values. Try rephrasing the question."
    );
  }

  return sql;
}
