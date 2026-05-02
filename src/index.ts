/**
 * OpenCode Plugin: Version Check — TUI entry (debug)
 *
 * Registers TWO commands to help isolate why /plugin_status isn't appearing:
 *   1. Non-slashed "Plugin Version Check" → should appear in Ctrl+P palette
 *   2. /plugin_status slash command → should appear in "/" autocomplete
 *
 * Activation toast confirms the plugin loaded successfully.
 */

import { buildStatusTable } from "./shared"

export default {
  id: "plugin-version-check",
  tui: (api: Record<string, unknown>, _options: unknown, _meta: unknown) => {
    const cmd = api.command as { register(cb: () => unknown[]): () => void }
    const tuiCfg = api.tuiConfig as { plugin?: Array<string | [string, Record<string, unknown>]> }
    const toast = (api.ui as { toast(i: { variant?: string; title?: string; message: string; duration?: number }): void }).toast.bind(api.ui)
    const sig = (api.lifecycle as { signal: AbortSignal }).signal

    // Confirm plugin activation
    toast({
      variant: "success",
      title: "Version Check loaded",
      message: "Plugin activated — registering commands…",
      duration: 4_000,
    })

    const exec = async () => {
      const raw = tuiCfg.plugin ?? []
      const table = await buildStatusTable(raw, sig)
      toast({ message: table, duration: 30_000 })
    }

    // 1) Command palette (no slash)
    cmd.register(() => [
      {
        title: "Plugin Version Check",
        value: "plugin-version-check.palette",
        description: "Debug: command palette entry — verify registration works",
        onSelect: exec,
      },
    ])

    // 2) Slash command
    cmd.register(() => [
      {
        title: "Plugin Version Status",
        value: "plugin-version-check.slash",
        description: "List configured plugins vs npm registry (incl. release dates)",
        slash: { name: "plugin_status", aliases: ["plugins", "check-plugins"] },
        onSelect: exec,
      },
    ])
  },
}
