import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Deployed to https://navisociety.github.io (bare org root via the
// `navisociety.github.io` repo), so base is '/'.
export default defineConfig({
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
