import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  const qualificationEnvironment = loadEnv(mode, ".", "");
  // Production cache identity changes on every build. Vite already content-
  // hashes emitted assets; this ID invalidates the PWA shell and un-hashed
  // public resources such as the manifest and icon.
  const buildId = command === "build"
    ? qualificationEnvironment.SOLID_FEATURE_RUNTIME_BUILD_ID ?? `${mode}-${Date.now().toString(36)}`
    : `serve-${mode}`;
  // The development theme module dynamically imports third-party test packs.
  // Keeping this false for every normal/pages build lets Rollup remove both
  // the module and its assets from the production graph.
  const bundleDevelopmentThemes = command === "serve" || mode === "development";
  return {
    base: mode === "pages" ? "/crawler/" : "/",
    build: { target: "es2022", sourcemap: true },
    define: {
      "import.meta.env.VITE_CRAWLER_BUILD_ID": JSON.stringify(buildId),
      __CRAWLER_BUNDLE_DEV_THEMES__: JSON.stringify(bundleDevelopmentThemes),
    },
    worker: { format: "es" },
  };
});
