import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // smart-fetch-core starts this as ./html-analysis-worker.js next to the bundle.
    "html-analysis-worker": "../core/src/html-analysis-worker.ts",
  },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  clean: true,
  bundle: true,
  noExternal: ["smart-fetch-core"],
  splitting: false,
  treeshake: true,
  external: [
    "@earendil-works/pi-coding-agent",
    "@sinclair/typebox",
    "wreq-js",
    "defuddle",
    "linkedom",
  ],
});
