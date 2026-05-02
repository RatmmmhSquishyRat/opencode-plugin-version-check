/**
 * OpenCode Plugin: Version Check — TUI entry
 *
 * Registers /plugin_status slash command for manual full listing.
 * Startup auto-check is removed — trigger via slash command instead.
 * Does NOT modify any files or config.
 */

import { buildStatusTable } from "./shared"

// ---------------------------------------------------------------------------
// Plugin entry — synchronous command registration (matches built-in pattern)
// ---------------------------------------------------------------------------
export default {
  id: "plugin-version-check",
  tui: (api: Record<string, unknown>, _options: unknown, _meta: unknown) => {
    const command = api.command as {
      register(cb: () => unknown[]): () => void
    }
    const tuiConfig = api.tuiConfig as { plugin?: Array<string | [string, Record<string, unknown>]> }
    const toast = (api.ui as { toast(i: { variant?: string; title?: string; message: string; duration?: number }): void }).toast.bind(api.ui)
    const signal = (api.lifecycle as { signal: AbortSignal }).signal

    command.register(() => [
      {
        title: "Plugin Version Check",
        value: "plugin-version-check.list",
        description: "List configured plugins vs latest npm versions (incl. release dates)",
        slash: { name: "plugin_status", aliases: ["plugins", "check-plugins"] },
        async onSelect() {
          const raw = tuiConfig.plugin ?? []
          const table = await buildStatusTable(raw, signal)
          toast({
            message: table,
            duration: 30_000,
          })
        },
      },
    ])

    // Return nothing — no hooks needed for TUI-only command registration
  },
}
