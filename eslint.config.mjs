import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Bundled skill examples — reference material, not app code.
    ".agents/**",
    ".claude/**",
    // A Python virtualenv that happens to vendor a few .js files (torch's
    // model_dump viewer, urllib3's emscripten worker). Linting it added ~70
    // warnings and an error about third-party code we do not ship, own, or
    // edit — enough noise to bury a real finding in our own source.
    "soundeffects-claude-code/**",
    // Generated knowledge-graph output.
    "graphify-out/**",
  ]),
  {
    rules: {
      // `const { key: _key, ...rest } = obj` is how this codebase drops a field
      // while spreading the rest; the leading underscore marks it deliberate.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
