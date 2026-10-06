import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

/** The UI to build, `ui/<entry>.ts` into `<entry>.js`; the Makefile's UI_ENTRIES lists them. */
const entry = process.env.UI_ENTRY;

// The host loads each entry as one self-contained ESM file from a blob URL, so CSS is
// injected by the component code, nothing is split into chunks, and entries build one at a time.
export default defineConfig(({ command }) => {
  if (command === "build" && !entry) throw new Error("set UI_ENTRY to the UI to build, or run make build-ui");
  return {
    plugins: [svelte({ compilerOptions: { css: "injected" } })],
    build: {
      outDir: "build/ui",
      emptyOutDir: false,
      lib: { entry: `ui/${entry}.ts`, formats: ["es"], fileName: () => `${entry}.js` },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
    resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
    // A fixed zone keeps schedule and template expectations independent of the machine.
    test: { environment: "jsdom", include: ["tests/**/*.test.ts"], env: { TZ: "America/Toronto" } },
  };
});
