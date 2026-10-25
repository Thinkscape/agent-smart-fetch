import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    // smart-fetch-core starts this as ./html-analysis-worker.js next to the bundle.
    "html-analysis-worker": "../core/src/html-analysis-worker.ts",
  },
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  bundle: true,
  noExternal: ["smart-fetch-core"],
  splitting: false,
  treeshake: true,
  external: [
    "@sinclair/typebox",
    "wreq-js",
    "defuddle",
    "linkedom",
    "mime-types",
    "lodash",
  ],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
