// ---------------------------------------------------------------------------
// Shared utilities: spec parsing, semver comparison, npm registry query.
// Used by both the TUI notifier and the server slash-command tool.
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

/**
 * Build a full copy-friendly markdown table comparing every configured
 * npm plugin against the latest on the registry.
 *
 * Used by both the TUI slash command and the server-side tool.
 */
export async function buildStatusTable(
  specs: Array<string | [string, Record<string, unknown>]>,
  signal: AbortSignal,
): Promise<string> {
  if (specs.length === 0) {
    return "No plugins configured in opencode.json / tui.json."
  }

  const locals: string[] = []
  const latestEntries: { name: string }[] = []
  const pinnedEntries: { name: string; current: string }[] = []

  for (const item of specs) {
    const spec = Array.isArray(item) ? String(item[0] ?? "") : String(item)
    if (!spec) continue

    if (isLocalPath(spec)) {
      locals.push(spec)
      continue
    }

    const parsed = parseNpmSpec(spec)
    if (!parsed) continue

    if (parsed.kind === "latest") {
      latestEntries.push({ name: parsed.name })
    } else {
      pinnedEntries.push({ name: parsed.name, current: parsed.configured })
    }
  }

  if (pinnedEntries.length === 0 && latestEntries.length === 0) {
    const lines = ["## Plugin Version Status", "", "No npm plugins configured."]
    if (locals.length > 0) {
      lines.push("", "Local file plugins (no version check):")
      for (const s of locals) lines.push(`  - ${s}`)
    }
    return lines.join("\n")
  }

  type Row = { name: string; configured: string; latest: string | null; date: string }
  const rows: Row[] = []

  const pinnedResults = await Promise.all(
    pinnedEntries.map(async ({ name, current }) => {
      const info = await fetchLatestVersion(name, signal)
      return { name, configured: current, latest: info?.version ?? null, date: info?.date ?? "" }
    }),
  )
  rows.push(...pinnedResults)

  const latestResults = await Promise.all(
    latestEntries.map(async ({ name }) => {
      const info = await fetchLatestVersion(name, signal)
      return { name, configured: "latest", latest: info?.version ?? null, date: info?.date ?? "" }
    }),
  )
  rows.push(...latestResults)

  const lines: string[] = [
    "## Plugin Version Status",
    "",
    "| Plugin | Configured | Latest | Released | Status |",
    "|--------|-----------|--------|----------|--------|",
  ]

  let outdated = 0
  let currentCount = 0
  let latestCount = 0
  let errored = 0

  for (const row of rows) {
    const rel = formatDate(row.date)
    if (!row.latest) {
      lines.push(`| \`${row.name}\` | ${row.configured} | ❓ failed | — | error |`)
      errored++
    } else if (row.configured === "latest") {
      lines.push(`| \`${row.name}\` | latest → **${row.latest}** | ${row.latest} | ${rel || "—"} | (resolved) |`)
      latestCount++
    } else if (row.configured === row.latest) {
      lines.push(`| \`${row.name}\` | ${row.configured} | ${row.latest} | ${rel || "—"} | ✅ current |`)
      currentCount++
    } else {
      lines.push(`| \`${row.name}\` | ${row.configured} | **${row.latest}** | ${rel || "—"} | ⚠️ outdated |`)
      outdated++
    }
  }

  lines.push("")
  const parts: string[] = [`${rows.length} checked`]
  if (currentCount > 0) parts.push(`${currentCount} current`)
  if (outdated > 0) parts.push(`${outdated} outdated`)
  if (latestCount > 0) parts.push(`${latestCount} @latest-resolved`)
  if (errored > 0) parts.push(`${errored} failed`)
  lines.push(`**Summary:** ${parts.join(" — ")}`)

  if (locals.length > 0) {
    lines.push("")
    lines.push("*Local file plugins (no version check):*")
    for (const s of locals) lines.push(`  - ${s}`)
  }

  lines.push("", "> Tip: run `opencode plugin install <pkg>@<version>` to pin or update a plugin.")

  return lines.join("\n")
}
