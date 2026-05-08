#!/usr/bin/env bun
/**
 * plugin-upgrade — upgrade npm-sourced plugins in the global OpenCode config
 * to their latest released versions.
 *
 * Usage:
 *   npm run plugin-upgrade                  # list upgradeable plugins
 *   npm run plugin-upgrade -- --all          # upgrade all to latest
 *   npm run plugin-upgrade -- <plugin-name>  # upgrade one plugin
 *   npm run plugin-upgrade -- <partial>      # search if name not found
 *   npm run plugin-upgrade -- --dry-run      # preview only, no write
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Replace the pinned version in a spec string.  Returns unchanged for
 *  @latest, git URLs, file paths, or unversioned specs. */
export function replaceVersionInSpec(spec: string, newVersion: string): string {
  if (spec.startsWith("file://") || spec.includes(":") && spec.includes("git+")) return spec
  if (spec.startsWith(".") || /^[A-Za-z]:[\\/]/.test(spec)) return spec

  const lastAt = findVersionAt(spec)
  if (lastAt < 0) return spec
  const currentVer = spec.slice(lastAt + 1)
  if (/^[a-zA-Z]+$/.test(currentVer)) return spec // dist-tag
  return spec.slice(0, lastAt + 1) + newVersion
}

/** Find the index of the '@' that starts the version suffix, or -1. */
function findVersionAt(spec: string): number {
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/")
    if (slash < 0) return -1
    return spec.indexOf("@", slash + 1)
  }
  return spec.indexOf("@")
}

/** Extract package name from an npm spec, or null. */
function npmPackageName(spec: string): string | null {
  const at = findVersionAt(spec)
  return at > 0 ? spec.slice(0, at) : at < 0 ? spec : null
}

/** Is this a git/git+https:// spec that should be skipped for registry upgrade. */
function isGitSpec(spec: string): boolean {
  const at = findVersionAt(spec)
  if (at < 0) return false
  const ver = spec.slice(at + 1)
  return ver.includes(":") || ver.startsWith("git+") || ver.startsWith("http")
}

/** Extract upgradeable npm-pinned specs from a config plugin list. */
export function pluginListForUpgrade(specs: Array<string | [string, unknown]>): Array<{ spec: string; name: string; current: string }> {
  const result: Array<{ spec: string; name: string; current: string }> = []
  for (const item of specs) {
    const spec = Array.isArray(item) ? String(item[0] ?? "") : String(item)
    if (!spec) continue
    if (spec.startsWith("file://") || spec.startsWith(".") || /^[A-Za-z]:[\\/]/.test(spec)) continue
    if (isGitSpec(spec)) continue

    const name = npmPackageName(spec)
    if (!name) continue

    const lastAt = findVersionAt(spec)
    if (lastAt < 0) continue
    const current = spec.slice(lastAt + 1)
    if (/^[a-zA-Z]+$/.test(current)) continue // dist-tag → skip

    result.push({ spec, name, current })
  }
  return result
}

/** Create a timestamped backup of the config file and return the backup path. */
export function backupConfig(filePath: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const backupPath = filePath.replace(/\.jsonc?$/, `.backup-${ts}.jsonc`)
  copyFileSync(filePath, backupPath)
  return backupPath
}

// ---------------------------------------------------------------------------
// JSONC parsing (minimal, shared with plugin-status)
// ---------------------------------------------------------------------------
function parseJsonc(raw: string): Record<string, unknown> {
  let out = ""
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    const next = raw[i + 1]
    if (ch === "/" && next === "/") {
      i += 2
      while (i < raw.length && raw[i] !== "\n" && raw[i] !== "\r") i++
      continue
    }
    if (ch === "/" && next === "*") {
      i += 2
      while (i < raw.length - 1 && !(raw[i] === "*" && raw[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (ch === '"') {
      out += ch
      i++
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === "\\") { out += raw[i++]; out += raw[i++] }
        else { out += raw[i++] }
      }
      if (i < raw.length) { out += raw[i]; i++ }
      continue
    }
    out += ch
    i++
  }
  out = out.replace(/,(\s*[}\]])/g, "$1")
  return JSON.parse(out) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// NPM registry
// ---------------------------------------------------------------------------
interface RegistryInfo {
  version: string
  date: string
}

async function fetchLatestVersion(name: string, signal: AbortSignal): Promise<RegistryInfo | null> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), 8_000)
  signal.addEventListener("abort", () => ctrl.abort(), { once: true })
  try {
    const resp = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: ctrl.signal })
    if (!resp.ok) return null
    const body = (await resp.json()) as { "dist-tags"?: { latest?: string }; time?: Record<string, string> }
    const version = body["dist-tags"]?.latest
    if (!version) return null
    return { version, date: body.time?.[version] ?? "" }
  } catch {
    return null
  } finally {
    clearTimeout(id)
  }
}

interface SearchResult {
  name: string
  version: string
  description: string
}

async function searchNpm(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), 8_000)
  signal.addEventListener("abort", () => ctrl.abort(), { once: true })
  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=5`
    const resp = await fetch(url, { signal: ctrl.signal })
    if (!resp.ok) return []
    const body = (await resp.json()) as { objects?: Array<{ package?: { name?: string; version?: string; description?: string } }> }
    return (body.objects ?? []).map((item) => ({
      name: item.package?.name ?? "?",
      version: item.package?.version ?? "?",
      description: item.package?.description ?? "",
    }))
  } catch {
    return []
  } finally {
    clearTimeout(id)
  }
}

function formatDate(iso: string): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  } catch {
    return iso.slice(0, 10)
  }
}

// ---------------------------------------------------------------------------
// Config path
// ---------------------------------------------------------------------------
function globalConfigPath(): string {
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
    : path.join(homedir(), ".config", "opencode")
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const file = path.join(dir, name)
    if (existsSync(file)) return file
  }
  return path.join(dir, "opencode.jsonc")
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
function printHelp() {
  console.log([
    "plugin-upgrade — upgrade npm plugins in OpenCode global config to latest",
    "",
    "Usage:",
    "  npm run plugin-upgrade               list upgradeable plugins",
    "  npm run plugin-upgrade -- --all      upgrade all plugins to latest",
    "  npm run plugin-upgrade -- <name>     upgrade one plugin",
    "  npm run plugin-upgrade -- <name> --dry-run  preview only",
    "",
    "Before modifying, a timestamped backup of the config file is created.",
  ].join("\n"))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  let upgradeAll = false
  let dryRun = false
  let targetName = ""

  for (const arg of args) {
    if (arg === "--all") upgradeAll = true
    else if (arg === "--dry-run") dryRun = true
    else if (arg === "--help" || arg === "-h") { printHelp(); return }
    else if (!arg.startsWith("-")) targetName = arg
  }

  const configFile = globalConfigPath()
  const rawText = readFileSync(configFile, "utf8")
  const cfg = parseJsonc(rawText)
  const specs = (cfg.plugin as Array<string | [string, unknown]>) ?? []

  if (specs.length === 0) {
    console.log("No plugins found in global config.")
    return
  }

  const upgradable = pluginListForUpgrade(specs)
  if (upgradable.length === 0) {
    console.log("No npm plugins with pinned versions in global config.")
    return
  }

  const ctrl = new AbortController()
  const sigint = () => ctrl.abort()
  process.on("SIGINT", sigint)

  // Fetch latest versions for all upgradeable plugins
  const rows: Array<{ spec: string; name: string; current: string; latest: string; date: string }> = []
  for (const entry of upgradable) {
    const info = await fetchLatestVersion(entry.name, ctrl.signal)
    rows.push({ ...entry, latest: info?.version ?? "?", date: info?.date ?? "" })
  }
  process.off("SIGINT", sigint)

  // If targeting a specific plugin
  if (targetName) {
    const match = rows.find((r) => r.name === targetName)
    if (!match) {
      console.log(`✗ "${targetName}" not found in global plugin config.`)
      const suggestions = await searchNpm(targetName, ctrl.signal)
      if (suggestions.length > 0) {
        const names = suggestions.map((s) => `  - ${s.name} (${s.version}) ${s.description ? `— ${s.description.slice(0, 60)}` : ""}`)
        console.log("\nDid you mean:")
        console.log(names.join("\n"))
        console.log(`\nRun: npm run plugin-upgrade -- <full-package-name>`)
      }
      return
    }

    if (match.latest === "?") {
      console.log(`✗ Failed to query latest version for "${match.name}".`)
      return
    }

    if (match.current === match.latest) {
      console.log(`${match.name} is already at the latest version (${match.latest}).`)
      return
    }

    if (dryRun) {
      console.log(`${match.name}  ${match.current} → ${match.latest}${match.date ? ` (${formatDate(match.date)})` : ""}`)
      console.log("(dry-run — no changes made)")
      return
    }

    // Backup and upgrade
    const backupPath = backupConfig(configFile)
    const newSpec = replaceVersionInSpec(match.spec, match.latest)
    const updated = rawText.replace(match.spec, newSpec)
    writeFileSync(configFile, updated)
    console.log(`✓ ${match.name}: ${match.current} → ${match.latest}`)
    console.log(`  Backup saved to ${backupPath}`)
    return
  }

  // List all
  const outdated = rows.filter((r) => r.latest !== "?" && r.current !== r.latest)
  const current = rows.filter((r) => r.latest !== "?" && r.current === r.latest)
  const failed = rows.filter((r) => r.latest === "?")

  if (current.length > 0) {
    for (const r of current) {
      const rel = formatDate(r.date)
      console.log(`  ${r.name.padEnd(40)} ${r.current}  (latest, ${rel || "?"})`)
    }
  }

  if (outdated.length > 0) {
    console.log()
    for (const r of outdated) {
      const rel = formatDate(r.date)
      console.log(`  ${r.name.padEnd(40)} ${r.current} → ${r.latest}${rel ? ` (${rel})` : ""}`)
    }
  }

  if (failed.length > 0) {
    console.log()
    for (const r of failed) {
      console.log(`  ${r.name.padEnd(40)} ${r.current}  (failed to query latest)`)
    }
  }

  console.log()
  console.log(`${rows.length} plugins checked — ${outdated.length} upgradeable, ${current.length} current, ${failed.length} query failed`)

  if (outdated.length === 0) {
    if (upgradeAll) console.log("All plugins are at the latest version.")
    return
  }

  if (!upgradeAll) {
    if (!dryRun) console.log("\nRun with --all to upgrade all, or specify a plugin name.")
    return
  }

  if (dryRun) {
    console.log("(dry-run — no changes made)")
    return
  }

  // Backup and apply all upgrades
  const backupPath = backupConfig(configFile)
  let updated = rawText

  for (const r of outdated) {
    const newSpec = replaceVersionInSpec(r.spec, r.latest)
    updated = updated.replace(r.spec, newSpec)
  }

  writeFileSync(configFile, updated)

  for (const r of outdated) {
    console.log(`✓ ${r.name}: ${r.current} → ${r.latest}`)
  }
  console.log(`\nBackup saved to ${backupPath}`)
}

main().catch((err) => {
  console.error(`[error] ${String(err)}`)
  process.exit(1)
})
