import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"

// We import the exported helpers from the upgrade script.
// The script must export at least these symbols for testing.
import {
  backupConfig,
  pluginListForUpgrade,
  replaceVersionInSpec,
} from "../scripts/plugin-upgrade"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempFile(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "opencode-upgrade-"))
  tempDirs.push(dir)
  const file = join(dir, "opencode.jsonc")
  writeFileSync(file, content)
  return file
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("replaceVersionInSpec upgrades pinned version in a bare string spec", () => {
  expect(replaceVersionInSpec("@scope/pkg@1.0.0", "2.0.0")).toBe("@scope/pkg@2.0.0")
  expect(replaceVersionInSpec("pkg@1.2.3", "1.3.0")).toBe("pkg@1.3.0")
})

test("replaceVersionInSpec returns unchanged for @latest or unversioned", () => {
  expect(replaceVersionInSpec("@scope/pkg", "2.0.0")).toBe("@scope/pkg")
  expect(replaceVersionInSpec("@scope/pkg@latest", "2.0.0")).toBe("@scope/pkg@latest")
  expect(replaceVersionInSpec("@scope/pkg@^1.0.0", "2.0.0")).toBe("@scope/pkg@^1.0.0")
  expect(replaceVersionInSpec("pkg@~1.2.0", "2.0.0")).toBe("pkg@~1.2.0")
  expect(replaceVersionInSpec("file:///local/plugin", "2.0.0")).toBe("file:///local/plugin")
})

test("pluginListForUpgrade extracts npm pinned specs, skips file/git/latest", () => {
  const specs = [
    "@scope/a@1.0.0",
    "@scope/b@latest",
    "@scope/range@^1.0.0",
    "file:///local/plugin",
    "plain-pkg@2.0.0",
    "range-pkg@~2.0.0",
    "pkg@git+https://github.com/x/y.git",
  ]
  const list = pluginListForUpgrade(specs)
  expect(list).toEqual([
    { spec: "@scope/a@1.0.0", name: "@scope/a", current: "1.0.0" },
    { spec: "plain-pkg@2.0.0", name: "plain-pkg", current: "2.0.0" },
  ])
})

test("backupConfig copies source to .backup-TIMESTAMP file", () => {
  const file = tempFile('{ "plugin": ["pkg@1.0.0"] }\n')
  const backupPath = backupConfig(file)
  expect(backupPath).toMatch(/\.backup-\d{8}T\d{6}\.jsonc$/)
  // Backup content matches original
  expect(readFileSync(backupPath, "utf8")).toBe('{ "plugin": ["pkg@1.0.0"] }\n')
})

test("importing plugin-upgrade does not execute CLI main", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-upgrade-import-"))
  tempDirs.push(dir)

  const configDir = join(dir, "opencode")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, "opencode.jsonc"), '{ "plugin": [] }\n')

  const scriptUrl = pathToFileURL(resolve(import.meta.dir, "../scripts/plugin-upgrade.ts")).href
  const result = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(scriptUrl)})`], {
    env: { ...process.env, XDG_CONFIG_HOME: dir },
    encoding: "utf8",
  })

  expect(result.status).toBe(0)
  expect(result.stdout).toBe("")
  expect(result.stderr).toBe("")
})
