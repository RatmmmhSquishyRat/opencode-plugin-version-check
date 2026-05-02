/**
 * OpenCode Plugin: Version Check — server tool
 *
 * Registers a "plugin_status" tool for AI invocation.
 * The /plugin_status slash command is registered by the TUI entry (index.ts).
 */

import { buildStatusTable } from "./shared"

// ---------------------------------------------------------------------------
// State captured from the config() hook during startup
// ---------------------------------------------------------------------------
let pluginSpecs: Array<string | [string, Record<string, unknown>]> = []

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------
export default {
  id: "plugin-version-check-commands",
  server: async (_input: unknown) => {
    return {
      config(cfg: { plugin?: Array<string | [string, Record<string, unknown>]> }) {
        pluginSpecs = cfg.plugin ?? []
      },
      tool: {
        plugin_status: {
          description:
            "List all plugins configured in opencode.json/tui.json showing their configured version, latest npm version, and release date. Includes @latest entries (resolved).",
          args: {} as Record<string, never>,
          async execute(_args: Record<string, never>, ctx: { abort: AbortSignal }): Promise<string> {
            return buildStatusTable(pluginSpecs, ctx.abort)
          },
        },
      },
    }
  },
}
