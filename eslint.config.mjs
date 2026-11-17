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
    "public/pdfjs/**",
    // Codi generat o còpies de la web pública (es comproven amb les proves de comparació)
    "public/configurador/**",
    "web-integracio/**",
    "tests/web-reference/**",
  ]),
]);

export default eslintConfig;
