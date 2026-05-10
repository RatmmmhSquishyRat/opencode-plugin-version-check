import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    commands: "src/commands.ts",
    "scripts/plugin-status": "scripts/plugin-status.ts",
    "scripts/plugin-upgrade": "scripts/plugin-upgrade.ts",
  },
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  splitting: false,
})
