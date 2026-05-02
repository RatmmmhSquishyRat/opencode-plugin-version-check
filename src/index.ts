/**
 * OpenCode Plugin: Version Check — TUI entry
 *
 * On startup: checks pinned-version plugins and notifies if any are outdated.
 * Registers /plugin_status slash command for manual full listing.
 * @latest entries are skipped during auto-check but included in manual listing.
 */

import { buildStatusTable, fetchLatestVersion, isLocalPath, parseNpmSpec } from "./shared"

// ---------------------------------------------------------------------------
// Startup auto-check: notify only for outdated pinned plugins (skip @latest)
// ---------------------------------------------------------------------------
async function startupCheck(
  specs: Array<string | [string, Record<string, unknown>]>,
  signal: AbortSignal,
  toast: (i: { variant?: string; title?: string; message: string; duration?: number }) => void,
) {
  // Parse configured specs — skip @latest entries and local paths
  const pinned: { name: string; current: string }[] = []

  for (const item of specs) {
    const spec = Array.isArray(item) ? String(item[0] ?? "") : String(item)
    if (!spec) continue
    if (isLocalPath(spec)) continue

    const parsed = parseNpmSpec(spec)
    if (!parsed || parsed.kind !== "pinned") continue

    pinned.push({ name: parsed.name, current: parsed.configured })
  }

  if (pinned.length === 0) return

  // Fetch latest versions in parallel
  interface Row { name: string; configured: string; latest: string; date: string }
  const outdated: Row[] = []

  await Promise.all(
    pinned.map(async ({ name, current }) => {
      if (signal.aborted) return
      try {
        const info = await fetchLatestVersion(name, signal)
        if (info && info.version && info.version !== current) {
          outdated.push({ name, configured: current, latest: info.version, date: info.date })
        }
      } catch {
        // network error → skip, don't bother user
      }
    }),
  )

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
    "Use `/plugin_status` to see the full report.",
  ]

  toast({
    variant: "warning",
    title: "Plugin Update Available",
    message: lines.join("\n"),
    duration: 10_000,
  })
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------
export default {
  id: "plugin-version-check",
  tui: async (api: Record<string, unknown>, _options: unknown, _meta: unknown) => {
    const command = api.command as {
      register(cb: () => unknown[]): () => void
    }
    const tuiConfig = api.tuiConfig as { plugin?: Array<string | [string, Record<string, unknown>]> }
    const toast = (api.ui as { toast(i: { variant?: string; title?: string; message: string; duration?: number }): void })
      .toast.bind(api.ui)
    const signal = (api.lifecycle as { signal: AbortSignal }).signal

    // 1) Startup check for outdated pinned plugins
    const specs = tuiConfig.plugin ?? []
    void startupCheck(specs, signal, toast)

    // 2) Register /plugin_status slash command
    command.register(() => [
      {
        title: "Plugin Version Status",
        value: "plugin-version-check.status",
        description: "List configured plugins vs npm registry (incl. release dates)",
        slash: { name: "plugin_status", aliases: ["plugins", "check-plugins"] },
        async onSelect() {
          const table = await buildStatusTable(specs, signal)
          toast({
            message: table,
            duration: 30_000,
          })
        },
      },
    ])
  },
}
