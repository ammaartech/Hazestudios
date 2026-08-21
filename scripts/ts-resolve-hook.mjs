/**
 * Lets a plain `node` process import the app's TypeScript modules directly.
 *
 * The app compiles under a bundler, so its imports are extensionless
 * (`./fuzzy`, `@/lib/...`) — neither of which Node's ESM resolver accepts. This
 * hook fills both gaps so `verify-search.mjs` can exercise `src/lib/search/*`
 * as-is, with no build step between editing the matcher and testing it.
 *
 * Type *stripping* is not this file's job: Node has done that natively since
 * 22.18, and these modules only use erasable syntax.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  // `@/…` is the tsconfig path alias for `src/…`.
  let spec = specifier;
  if (spec.startsWith("@/")) {
    spec = pathToFileURL(join(ROOT, "src", spec.slice(2))).href;
  }

  try {
    return await nextResolve(spec, context);
  } catch (error) {
    // Extensionless relative import: try the TypeScript file it must have meant.
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;

    const base = spec.startsWith("file:")
      ? fileURLToPath(spec)
      : context.parentURL
        ? resolvePath(dirname(fileURLToPath(context.parentURL)), spec)
        : null;
    if (!base) throw error;

    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
    throw error;
  }
}
