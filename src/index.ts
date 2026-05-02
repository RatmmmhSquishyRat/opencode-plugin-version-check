/**
 * OpenCode Plugin: Version Check — TUI entry
 *
 * - Startup: scans pinned-version plugins, shows toast for outdated ones
 *   (skips @latest silently).
 * - Registers /plugin_status slash command for manual full listing.
 * - Does NOT modify any files or config.
 */

import { parsePinnedSpec, isNewer, fetchLatestVersion, formatDate, buildStatusTable } from "./shared"

// ---------------------------------------------------------------------------
// Runtime API surface (provided by OpenCode TUI plugin host at runtime)
// ---------------------------------------------------------------------------
interface PluginApi {
  ui: {
    toast(input: {
      variant?: "info" | "success" | "warning" | "error"
      title?: string
      message: string
      duration?: number
    }): void
  }
  tuiConfig: {
    plugin?: Array<string | [string, Record<string, unknown>]>
  }
  kv: {
    get<T = unknown>(key: string, fallback?: T): T
    set(key: string, value: unknown): void
  }
  lifecycle: {
    signal: AbortSignal
  }
  command: {
    register(cb: () => TuiCommand[]): () => void
  }
}

interface TuiCommand {
  title: string
  value: string
  description?: string
  slash?: { name: string; aliases?: string[] }
  onSelect?: () => void
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------
export default {
  id: "plugin-version-check",
  tui: async (api: PluginApi, _options: unknown, _meta: unknown) => {
    // 1) Startup: auto-check pinned plugins, toast if outdated
    await checkPinnedVersions(api)

    // 2) Register /plugin_status slash command for manual full listing
    api.command.register(() => [
      {
        title: "Plugin Version Check",
        value: "Plugin: Version Check",
        description: "List all configured plugins with their current vs latest version",
        slash: { name: "plugin_status", aliases: ["plugins", "check-plugins"] },
        async onSelect() {
          const raw = api.tuiConfig.plugin ?? []
          const table = await buildStatusTable(raw, api.lifecycle.signal)
          api.ui.toast({
            variant: "info",
            message: table,
            duration: 30_000,
          })
        },
      },
    ])
  },
}

// ---------------------------------------------------------------------------
// Startup pinned-version check (skips @latest)
// ---------------------------------------------------------------------------
const KV_KEY = "plugin-version-check:last-run"

async function checkPinnedVersions(api: PluginApi): Promise<void> {
  const lastRun = api.kv.get<number>(KV_KEY, 0)
  if (lastRun > 0) return
  api.kv.set(KV_KEY, Date.now())

  const raw = api.tuiConfig.plugin
  if (!Array.isArray(raw) || raw.length === 0) return

  const entries: { name: string; current: string }[] = []
  for (const item of raw) {
    const parsed = parsePinnedSpec(item)
    if (!parsed) continue
    entries.push(parsed)
  }
  if (entries.length === 0) return

  const checks = entries.map(async ({ name, current }) => {
    const info = await fetchLatestVersion(name, api.lifecycle.signal)
    if (!info) return
    if (!isNewer(current, info.version)) return

    const date = formatDate(info.date)
    api.ui.toast({
      variant: "warning",
      title: "Plugin Update Available",
      message: `${name}: ${current} → ${info.version}${date ? ` (${date})` : ""}`,
      duration: 10_000,
    })
  })

  await Promise.allSettled(checks)
}
