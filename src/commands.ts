/**
 * OpenCode Plugin: Version Check — server tool
 *
 * Registers a "plugin_status" tool for AI invocation.
 * User-facing status is available via `npm run plugin-status`.
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
            "List OpenCode plugins showing installed cache version, latest npm release, and release date.",
          args: {} as Record<string, never>,
          async execute(_args: Record<string, never>, ctx: { abort: AbortSignal }): Promise<string> {
            return buildStatusTable(pluginSpecs, ctx.abort)
          },
        },
      },
    }
  },
}
