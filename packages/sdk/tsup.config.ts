import { defineConfig } from "tsup";

// The reason codes come from the canonical schema package and are bundled in, so the published
// SDK has no workspace dependency. viem stays external: customers bring their own.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  noExternal: ["@palisec/policy-schema"],
  external: ["viem"],
});
