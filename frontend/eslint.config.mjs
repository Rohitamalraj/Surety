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
  ]),
  {
    rules: {
      // Intentional, hydration-safe patterns: a mounted flag, restoring sessionStorage after the
      // World ID redirect, resetting local state when a prop changes. Keep visible, don't fail builds.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
