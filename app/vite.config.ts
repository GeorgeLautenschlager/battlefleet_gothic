import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the same build works at / locally and at /battlefleet_gothic/ on GitHub Pages.
  base: "./",
  // The engine is a sibling package, imported as TypeScript source.
  server: { fs: { allow: [".."] } },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"] },
});
