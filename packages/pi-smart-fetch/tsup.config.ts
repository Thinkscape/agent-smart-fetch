import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
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
