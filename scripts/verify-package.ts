import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

const requiredFiles = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/commands.js",
  "dist/commands.d.ts",
  "dist/scripts/plugin-status.js",
  "dist/scripts/plugin-upgrade.js",
  "README.md",
  "LICENSE",
]

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`Missing required package file: ${file}`)
  }
}

const packageJson = await Bun.file("package.json").json()

if (packageJson.name !== "@ratteeth1/opencode-plugin-version-check") {
  throw new Error("package.json name must be @ratteeth1/opencode-plugin-version-check")
}

if (packageJson.main !== "./dist/index.js") {
  throw new Error("package.json main must point to ./dist/index.js")
}

if (packageJson.types !== "./dist/index.d.ts") {
  throw new Error("package.json types must point to ./dist/index.d.ts")
}

if (packageJson.exports?.["./tui"]?.import !== "./dist/index.js") {
  throw new Error("package.json ./tui export must point to ./dist/index.js")
}

if (packageJson.exports?.["./server"]?.import !== "./dist/commands.js") {
  throw new Error("package.json ./server export must point to ./dist/commands.js")
}

if (packageJson.bin?.["opencode-plugin-status"] !== "./dist/scripts/plugin-status.js") {
  throw new Error("package.json opencode-plugin-status bin must point to ./dist/scripts/plugin-status.js")
}

if (packageJson.bin?.["opencode-plugin-upgrade"] !== "./dist/scripts/plugin-upgrade.js") {
  throw new Error("package.json opencode-plugin-upgrade bin must point to ./dist/scripts/plugin-upgrade.js")
}

const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
})

if (pack.status !== 0) {
  throw new Error(pack.stderr || "npm pack --dry-run failed")
}

const packs = JSON.parse(pack.stdout) as Array<{
  files: Array<{ path: string }>
}>
const files = packs[0]?.files.map((file) => file.path) ?? []

for (const file of requiredFiles) {
  if (!files.includes(file.replaceAll("\\", "/"))) {
    throw new Error(`npm pack output does not include ${file}`)
  }
}

const forbiddenPrefixes = ["src/", "scripts/", "test/", ".github/", "node_modules/"]
for (const file of files) {
  const forbidden = forbiddenPrefixes.find((prefix) => file.startsWith(prefix))
  if (forbidden) {
    throw new Error(`npm pack output includes forbidden file: ${file}`)
  }
}

console.log(`Package verification passed (${files.length} files).`)
