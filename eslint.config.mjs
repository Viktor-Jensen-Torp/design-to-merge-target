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
    // Root of trust. Copied verbatim from the design repo, exactly as
    // .prettierignore already says — linting it here reports findings against
    // a file this project does not own and cannot fix. `.pi/extensions/
    // submit.ts` tripped import/no-anonymous-default-export on every single
    // agent run until 2026-09-17.
    ".pi/**",
    ".agents/**",
  ]),
]);

export default eslintConfig;
