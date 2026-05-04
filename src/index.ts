/**
 * OpenCode Plugin: Version Check — TUI entry
 *
 * On startup: checks pinned-version plugins and notifies if any are outdated.
 * @latest entries are skipped during auto-check.
 *
 * For the full status table, run the standalone CLI script:
 *   npm run plugin-status
 */

import { buildOutdatedPinnedRows } from "./shared"
import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { isLocalPath, npmPackageName } from "./shared"

type PluginSpec = string | [string, Record<string, unknown>]

// ---------------------------------------------------------------------------
// Startup auto-check: notify only for outdated pinned plugins (skip @latest)
// ---------------------------------------------------------------------------
async function startupCheck(
  specs: PluginSpec[],
  signal: AbortSignal,
  toast: (i: { variant?: string; title?: string; message: string; duration?: number }) => void,
) {
  const outdated = await buildOutdatedPinnedRows(specs, signal).catch(() => [])

  if (outdated.length === 0) return

  const label = outdated.length === 1 ? "plugin" : "plugins"
  const lines = [
    `**${outdated.length} ${label} outdated:**`,
    "",
    ...outdated.map((r) => {
      const d = r.date ? ` (${r.date.slice(0, 10)})` : ""
      return `- \`${r.name}\`: ${r.configured} → **${r.latest}**${d}`
    }),
    "",
    "Run `npm run plugin-status` in the plugin-version-check repo for the full report.",
  ]

  toast({
    variant: "warning",
    title: "Plugin Update Available",
    message: lines.join("\n"),
    duration: 10_000,
  })
}

function dedupeSpecs(...lists: Array<PluginSpec[] | undefined>): PluginSpec[] {
  const seen = new Set<string>()
  const result: PluginSpec[] = []
  for (const list of lists) {
    for (const item of list ?? []) {
      const spec = Array.isArray(item) ? String(item[0] ?? "") : String(item)
      if (!spec) continue
      const key = spec.startsWith("file://") || isLocalPath(spec) ? spec : (npmPackageName(spec) ?? spec)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

function snapshotPath() {
  const base = process.env.XDG_STATE_HOME ? process.env.XDG_STATE_HOME : path.join(homedir(), ".local", "state")
  return path.join(base, "opencode", "plugin-version-check", "plugins.json")
}

function writePluginSnapshot(specs: PluginSpec[]) {
  const file = snapshotPath()
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          plugins: specs.map((item) => (Array.isArray(item) ? String(item[0] ?? "") : String(item))).filter(Boolean),
        },
        null,
        2,
      ),
    )
  } catch (error) {
    console.warn(`[plugin-version-check] failed to write plugin snapshot: ${String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------
export default {
  id: "plugin-version-check",
  tui: async (api: Record<string, unknown>, _options: unknown, _meta: unknown) => {
    const state = api.state as { config?: { plugin?: PluginSpec[] } }
    const tuiConfig = api.tuiConfig as { plugin?: PluginSpec[] }
    const toast = (api.ui as { toast(i: { variant?: string; title?: string; message: string; duration?: number }): void })
      .toast.bind(api.ui)
    const signal = (api.lifecycle as { signal: AbortSignal }).signal

    const specs = () => dedupeSpecs(state.config?.plugin, tuiConfig.plugin)
    const current = specs()
    writePluginSnapshot(current)
    void startupCheck(current, signal, toast)
  },
}
