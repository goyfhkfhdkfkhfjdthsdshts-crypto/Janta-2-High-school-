import { defineConfig } from "eslint/config";
import next from "eslint-config-next";

export default defineConfig([
  {
    ignores: [
      ".next/**",
      ".next-dev/**",
      "out/**",
      "node_modules/**",
      "scripts/**",
      ".api_static_export_backup/**",
    ],
  },
  {
    extends: [...next],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
