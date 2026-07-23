/**
 * Shared Postgres connection config for the db:* scripts.
 *
 * Why this isn't just `new pg.Client({ connectionString })`:
 *
 * Supabase database passwords routinely contain `@`, `#`, `$`, `!` and friends,
 * and the dashboard hands you a URI with the password inlined *unencoded*. That
 * string is not a valid URL. `@` collides with the userinfo/host separator and
 * `#` starts a fragment, so a strict parser either throws or silently truncates
 * the password and then reports "password authentication failed" — which sends
 * you looking in entirely the wrong place.
 *
 * So: split on the LAST `@` (the host separator can only be the final one, since
 * a hostname cannot contain `@`), take everything before it as userinfo, and
 * split userinfo on its FIRST `:`. Everything between is the password, verbatim,
 * however many reserved characters it happens to contain.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env.local reader. Values are taken raw — no unquoting of the body. */
export function loadEnv() {
  try {
    const text = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Absent .env.local is fine when the variable is exported some other way.
  }
}

/**
 * @returns {{user:string,password:string,host:string,port:number,database:string}}
 */
export function parseConnectionString(raw) {
  const withoutScheme = raw.replace(/^postgres(ql)?:\/\//, "");
  if (withoutScheme === raw) {
    throw new Error("SUPABASE_DB_URL must start with postgresql:// or postgres://");
  }

  // Trailing ?sslmode=… etc. pg gets its TLS settings from us, not the URI.
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

  // If the password *was* correctly percent-encoded, decode it. A password that
  // was pasted raw stays raw: decodeURIComponent throws on a stray '%', and a
  // password with no '%' at all round-trips unchanged either way.
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
  if (/^\[.*\]$/.test(password) || /your-?password/i.test(password)) {
    throw new Error(
      "SUPABASE_DB_URL still contains the [YOUR-PASSWORD] placeholder — replace it with the real password"
    );
  }

  return { user, password, host, port, database };
}

/** Full pg client config. Never log this object — it carries the password. */
export function dbConfig() {
  loadEnv();
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) {
    const err = new Error("SUPABASE_DB_URL is not set");
    err.help =
      "Add it to .env.local (gitignored). Supabase Dashboard →\n" +
      "Project Settings → Database → Connection string → URI, mode: Session pooler.\n\n" +
      "  SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres";
    throw err;
  }

  const parts = parseConnectionString(raw);
  return {
    ...parts,
    // Supabase terminates TLS with a chain this client has no root for. The
    // connection is still encrypted; only chain verification is relaxed.
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
  };
}

/** Safe one-line description — deliberately omits the password. */
export function describeTarget(config) {
  return `${config.user}@${config.host}:${config.port}/${config.database}`;
}
