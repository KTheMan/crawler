import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "/crawler/" : "/",
  build: { target: "es2022", sourcemap: true },
  worker: { format: "es" },
}));
