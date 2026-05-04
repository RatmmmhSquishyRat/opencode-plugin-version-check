import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { buildOutdatedPinnedRows, buildStatusTable } from "../src/shared"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("buildStatusTable shows installed version from OpenCode cache and latest release only", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "opencode-plugin-cache-"))
  tempDirs.push(cacheRoot)

  const installedPackageJson = join(
    cacheRoot,
    "packages",
    "@scope",
    "plugin@latest",
    "node_modules",
    "@scope",
    "plugin",
    "package.json",
  )
  mkdirSync(dirname(installedPackageJson), { recursive: true })
  writeFileSync(installedPackageJson, JSON.stringify({ name: "@scope/plugin", version: "1.0.0" }))

  const table = await buildStatusTable(["@scope/plugin@latest"], new AbortController().signal, {
    cacheRoots: [cacheRoot],
    fetchLatest: async () => ({ version: "1.2.0", date: "2026-05-03T00:00:00.000Z" }),
  })

  expect(table).toContain("| Plugin | Installed | Latest Released | Status |")
  expect(table).toContain("| `@scope/plugin` | 1.0.0 | **1.2.0** (2026-05-03) | ⚠️ outdated |")
  expect(table).not.toContain("Configured")
})

test("buildStatusTable skips git specs because npm registry latest is unrelated", async () => {
  const table = await buildStatusTable(["superpowers@git+https://github.com/obra/superpowers.git"], new AbortController().signal, {
    fetchLatest: async () => ({ version: "0.0.2", date: "2022-01-14T00:00:00.000Z" }),
  })

  expect(table).toContain("No npm plugins configured")
  expect(table).not.toContain("superpowers")
})

test("startup rows notify only when a pinned plugin is behind latest", async () => {
  const rows = await buildOutdatedPinnedRows(
    ["behind-plugin@1.0.0", "current-plugin@2.0.0", "ahead-plugin@3.0.0", "latest-plugin@latest"],
    new AbortController().signal,
    async (name) => {
      const versions: Record<string, { version: string; date: string }> = {
        "behind-plugin": { version: "1.1.0", date: "2026-05-01T00:00:00.000Z" },
        "current-plugin": { version: "2.0.0", date: "2026-05-02T00:00:00.000Z" },
        "ahead-plugin": { version: "2.9.0", date: "2026-05-03T00:00:00.000Z" },
        "latest-plugin": { version: "9.9.9", date: "2026-05-04T00:00:00.000Z" },
      }
      return versions[name] ?? null
    },
  )

  expect(rows).toEqual([
    { name: "behind-plugin", configured: "1.0.0", latest: "1.1.0", date: "2026-05-01T00:00:00.000Z" },
  ])
})

test("startup rows ignore registry failures without suppressing other outdated plugins", async () => {
  const rows = await buildOutdatedPinnedRows(
    ["broken-plugin@1.0.0", "behind-plugin@1.0.0"],
    new AbortController().signal,
    async (name) => {
      if (name === "broken-plugin") throw new Error("registry unavailable")
      return { version: "1.1.0", date: "2026-05-01T00:00:00.000Z" }
    },
  )

  expect(rows).toEqual([
    { name: "behind-plugin", configured: "1.0.0", latest: "1.1.0", date: "2026-05-01T00:00:00.000Z" },
  ])
})
