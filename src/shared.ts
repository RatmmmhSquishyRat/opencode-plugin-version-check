import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

// ---------------------------------------------------------------------------
// Shared utilities: spec parsing, semver comparison, npm registry/cache query.
// Used by the TUI notifier, server tool, and standalone CLI.
// ---------------------------------------------------------------------------

/**
 * Parse a config plugin spec (string or [string, options]) and extract
 * { name, version } for entries that pin a specific semver version.
 *
 * Returns null for entries that should be skipped:
 *  - file:// paths, relative/absolute local paths
 *  - un-versioned entries (treated as @latest)
 *  - dist-tags (latest, next, beta, …)
 *  - semver ranges (^1.0.0, ~1.0.0, >=1.0.0, …)
 */
export function parsePinnedSpec(raw: unknown): { name: string; version: string } | null {
  const spec = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0] ?? "") : ""
  if (!spec) return null

  // File-system paths
  if (spec.startsWith("file://") || spec.startsWith(".") || spec.startsWith("/")) return null
  if (/^[A-Za-z]:[\\/]/.test(spec)) return null

  // Find version separator (last @ for scoped packages: @scope/name@1.0.0)
  let atIdx = -1
  if (spec.startsWith("@")) {
    atIdx = spec.indexOf("@", 1)
  } else {
    atIdx = spec.indexOf("@")
  }
  if (atIdx <= 0) return null // no version → @latest

  const name = spec.slice(0, atIdx)
  const rawVer = spec.slice(atIdx + 1)
  if (!name || !rawVer) return null

  // Dist-tags (alphabetic only)
  if (/^[a-zA-Z]+$/.test(rawVer)) return null

  // Semver ranges / wildcards
  if (/[><^~|*xX]/.test(rawVer)) return null

  // Allow leading "v" prefix
  const clean = rawVer.replace(/^v/, "")
  if (!/^\d+\.\d+\.\d+/.test(clean)) return null

  return { name, version: clean }
}

export interface LatestInfo {
  version: string
  date: string
}

/** Check if a spec string is a local file path (not an npm package name). */
export function isLocalPath(spec: string): boolean {
  if (spec.startsWith("file://") || spec.startsWith(".") || spec.startsWith("/")) return true
  if (/^[A-Za-z]:[\\/]/.test(spec)) return true
  return false
}

/** Result of parsing an npm plugin spec — either a pinned version or a latest-tag entry. */
export type NpmEntry =
  | { kind: "pinned"; name: string; configured: string }
  | { kind: "latest"; name: string }

/**
 * Parse an npm plugin spec.  Unlike parsePinnedSpec this does NOT skip
 * latest-tag or unversioned entries — it classifies everything that looks
 * like an npm reference.
 */
export function parseNpmSpec(spec: string): NpmEntry | null {
  if (!spec || isLocalPath(spec)) return null

  let atIdx = -1
  if (spec.startsWith("@")) {
    atIdx = spec.indexOf("@", 1)
  } else {
    atIdx = spec.indexOf("@")
  }

  if (atIdx <= 0) {
    return { kind: "latest", name: spec }
  }

  const name = spec.slice(0, atIdx)
  const rawVer = spec.slice(atIdx + 1)
  if (!name || !rawVer) return null

  // Dist-tags → treat as latest
  if (/^[a-zA-Z]+$/.test(rawVer)) {
    return { kind: "latest", name }
  }

  // Semver ranges / wildcards → skip
  if (/[><^~|*xX]/.test(rawVer)) return null

  const clean = rawVer.replace(/^v/, "")
  if (!/^\d+\.\d+\.\d+/.test(clean)) return null

  return { kind: "pinned", name, configured: clean }
}

export function npmPackageName(spec: string): string | null {
  if (!spec || isLocalPath(spec)) return null

  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/")
    if (slash < 0) return null
    const versionAt = spec.indexOf("@", slash + 1)
    if (versionAt > 0 && !isRegistryVersion(spec.slice(versionAt + 1))) return null
    return versionAt > 0 ? spec.slice(0, versionAt) : spec
  }

  const versionAt = spec.indexOf("@")
  if (versionAt > 0 && !isRegistryVersion(spec.slice(versionAt + 1))) return null
  return versionAt > 0 ? spec.slice(0, versionAt) : spec
}

function isRegistryVersion(version: string): boolean {
  if (!version) return false
  if (version.includes(":") || version.includes("/")) return false
  if (version.startsWith("git+") || version.startsWith("http")) return false
  return true
}

function sanitizeCacheName(spec: string): string {
  if (process.platform !== "win32") return spec
  const illegal = new Set(["<", ">", ":", '"', "|", "?", "*"])
  return Array.from(spec, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

export function defaultCacheRoots(): string[] {
  const roots = new Set<string>()
  if (process.env.XDG_CACHE_HOME) roots.add(path.join(process.env.XDG_CACHE_HOME, "opencode"))
  roots.add(path.join(homedir(), ".cache", "opencode"))
  if (process.env.LOCALAPPDATA) roots.add(path.join(process.env.LOCALAPPDATA, "opencode"))
  return Array.from(roots)
}

export function readInstalledVersion(spec: string, cacheRoots = defaultCacheRoots()): string | null {
  const name = npmPackageName(spec)
  if (!name) return null

  const cacheName = sanitizeCacheName(spec)
  for (const root of cacheRoots) {
    const file = path.join(root, "packages", cacheName, "node_modules", name, "package.json")
    if (!existsSync(file)) continue
    try {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }
      return typeof pkg.version === "string" && pkg.version ? pkg.version : null
    } catch {
      return null
    }
  }

  return null
}

/** Simple semver comparison.  Returns true when candidate > reference. */
export function isNewer(reference: string, candidate: string): boolean {
  const a = reference.split(".").map((n) => parseInt(n, 10) || 0)
  const b = candidate.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if (b[i]! > a[i]!) return true
    if (b[i]! < a[i]!) return false
  }
  return false
}

/** Format an ISO date string into `YYYY-MM-DD`. */
export function formatDate(iso: string): string {
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

/**
 * Fetch the latest version AND its publish date from the npm registry.
 * Queries the full packument so we can read `dist-tags.latest` and `time[version]`.
 * Returns null on any failure (network, not found, timeout).
 */
export async function fetchLatestVersion(name: string, signal: AbortSignal): Promise<LatestInfo | null> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), 8_000)
  signal.addEventListener("abort", () => ctrl.abort(), { once: true })

  try {
    const resp = await fetch(`https://registry.npmjs.org/${name}`, { signal: ctrl.signal })
    if (!resp.ok) return null
    const body = (await resp.json()) as {
      "dist-tags"?: { latest?: string }
      time?: Record<string, string>
    }
    const version = body["dist-tags"]?.latest
    if (!version) return null
    return {
      version,
      date: body.time?.[version] ?? "",
    }
  } catch {
    return null
  } finally {
    clearTimeout(id)
  }
}

export interface OutdatedPinnedRow {
  name: string
  configured: string
  latest: string
  date: string
}

export async function buildOutdatedPinnedRows(
  specs: Array<string | [string, Record<string, unknown>]>,
  signal: AbortSignal,
  fetchLatest: typeof fetchLatestVersion = fetchLatestVersion,
): Promise<OutdatedPinnedRow[]> {
  const pinned: { name: string; current: string }[] = []

  for (const item of specs) {
    const spec = Array.isArray(item) ? String(item[0] ?? "") : String(item)
    if (!spec) continue
    if (isLocalPath(spec)) continue

    const parsed = parseNpmSpec(spec)
    if (!parsed || parsed.kind !== "pinned") continue

    pinned.push({ name: parsed.name, current: parsed.configured })
  }

  const rows = await Promise.all(
    pinned.map(async ({ name, current }) => {
      if (signal.aborted) return null
      const info = await fetchLatest(name, signal).catch(() => null)
      if (!info || !info.version || !isNewer(current, info.version)) return null
      return { name, configured: current, latest: info.version, date: info.date }
    }),
  )

  return rows.filter((row): row is OutdatedPinnedRow => row !== null)
}

/**
 * Build a full copy-friendly markdown table comparing every configured
 * npm plugin against the latest on the registry.
 *
 * Used by both the TUI slash command and the server-side tool.
 */
export async function buildStatusTable(
  specs: Array<string | [string, Record<string, unknown>]>,
  signal: AbortSignal,
  options: { cacheRoots?: string[]; fetchLatest?: typeof fetchLatestVersion } = {},
): Promise<string> {
  if (specs.length === 0) {
    return "No plugins configured in opencode.json / tui.json."
  }

  const locals: string[] = []
  const npmEntries: { name: string; spec: string }[] = []

  for (const item of specs) {
    const spec = Array.isArray(item) ? String(item[0] ?? "") : String(item)
    if (!spec) continue

    if (isLocalPath(spec)) {
      locals.push(spec)
      continue
    }

    const name = npmPackageName(spec)
    if (!name) continue
    npmEntries.push({ name, spec })
  }

  if (npmEntries.length === 0) {
    const lines = ["## Plugin Version Status", "", "No npm plugins configured."]
    if (locals.length > 0) {
      lines.push("", "Local file plugins (no version check):")
      for (const s of locals) lines.push(`  - ${s}`)
    }
    return lines.join("\n")
  }

  const fetchLatest = options.fetchLatest ?? fetchLatestVersion
  const rows = await Promise.all(
    npmEntries.map(async ({ name, spec }) => {
      const info = await fetchLatest(name, signal)
      return {
        name,
        installed: readInstalledVersion(spec, options.cacheRoots),
        latest: info?.version ?? null,
        date: info?.date ?? "",
      }
    }),
  )

  const lines: string[] = [
    "## Plugin Version Status",
    "",
    "| Plugin | Installed | Latest Released | Status |",
    "|--------|-----------|-----------------|--------|",
  ]

  let outdated = 0
  let currentCount = 0
  let missing = 0
  let errored = 0

  for (const row of rows) {
    const rel = formatDate(row.date)
    const latest = row.latest ? `${row.installed === row.latest ? row.latest : `**${row.latest}**`}${rel ? ` (${rel})` : ""}` : "❓ failed"
    if (!row.installed) {
      lines.push(`| \`${row.name}\` | not installed | ${latest} | not installed |`)
      missing++
    } else if (!row.latest) {
      lines.push(`| \`${row.name}\` | ${row.installed} | ${latest} | unknown |`)
      errored++
    } else if (row.installed === row.latest) {
      lines.push(`| \`${row.name}\` | ${row.installed} | ${latest} | ✅ current |`)
      currentCount++
    } else {
      lines.push(`| \`${row.name}\` | ${row.installed} | ${latest} | ⚠️ outdated |`)
      outdated++
    }
  }

  lines.push("")
  const parts: string[] = [`${rows.length} checked`]
  if (currentCount > 0) parts.push(`${currentCount} current`)
  if (outdated > 0) parts.push(`${outdated} outdated`)
  if (missing > 0) parts.push(`${missing} not installed`)
  if (errored > 0) parts.push(`${errored} failed`)
  lines.push(`**Summary:** ${parts.join(" — ")}`)

  if (locals.length > 0) {
    lines.push("")
    lines.push("*Local file plugins (no version check):*")
    for (const s of locals) lines.push(`  - ${s}`)
  }

  lines.push("", "> Installed versions are read from OpenCode's plugin cache node_modules.")

  return lines.join("\n")
}
