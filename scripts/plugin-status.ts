#!/usr/bin/env bun
/**
 * plugin-status — standalone CLI that reads opencode config files and prints
 * a markdown table comparing configured plugin versions against the latest
 * on the npm registry.
 *
 * Usage:
 *   bun scripts/plugin-status.ts                    # cwd as project root
 *   bun scripts/plugin-status.ts --project <path>    # explicit project root
 *   npm run plugin-status                            # from plugin repo (project = ../..)
 *
 * Reads:
 *   ~/.config/opencode/opencode.jsonc   (global plugins)
 *   <project>/.opencode/opencode.jsonc  (server plugins)
 *   <project>/.opencode/tui.jsonc       (TUI plugins)
 */

import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { buildStatusTable } from "../src/shared"

// ---------------------------------------------------------------------------
// Minimal JSONC parser (strips // and /* */ comments)
// ---------------------------------------------------------------------------
function parseJsonc(raw: string): Record<string, unknown> {
  let out = ""
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    const next = raw[i + 1]
    // single-line comment
    if (ch === "/" && next === "/") {
      i += 2
      while (i < raw.length && raw[i] !== "\n" && raw[i] !== "\r") i++
      continue
    }
    // block comment
    if (ch === "/" && next === "*") {
      i += 2
      while (i < raw.length - 1 && !(raw[i] === "*" && raw[i + 1] === "/")) i++
      i += 2
      continue
    }
    // string literal — copy verbatim to avoid misinterpreting / inside strings
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
  // strip trailing commas before JSON.parse
  out = out.replace(/,(\s*[}\]])/g, "$1")
  return JSON.parse(out) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Safe read
// ---------------------------------------------------------------------------
async function readConfig(path: string): Promise<Record<string, unknown> | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  try {
    return parseJsonc(await file.text())
  } catch (e: unknown) {
    console.warn(`[warn] Failed to parse ${path}: ${String(e)}`)
    return null
  }
}

async function readSnapshot(): Promise<string[] | null> {
  const base = process.env.XDG_STATE_HOME ? process.env.XDG_STATE_HOME : join(homedir(), ".local", "state")
  const file = Bun.file(join(base, "opencode", "plugin-version-check", "plugins.json"))
  if (!(await file.exists())) return null
  try {
    const data = (await file.json()) as { plugins?: unknown }
    if (!Array.isArray(data.plugins)) return null
    return data.plugins.filter((item): item is string => typeof item === "string" && item.length > 0)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
function printHelp() {
  console.log([
    "plugin-status — list configured OpenCode plugins with latest versions",
    "",
    "Usage:",
    "  bun scripts/plugin-status.ts [--project <path>] [--help]",
    "",
    "Options:",
    "  --project <path>  Project root directory (default: cwd)",
    "  --help            Show this help",
  ].join("\n"))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  let project = process.cwd()

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--project" || a === "-p") {
      project = resolve(args[++i] ?? ".")
    } else if (a === "--help" || a === "-h") {
      printHelp()
      return
    }
  }

  const globalDir = join(homedir(), ".config", "opencode")
  const projectDir = join(project, ".opencode")

  const specs: Array<string | [string, Record<string, unknown>]> = []
  const seen = new Set<string>()

  function add(item: unknown) {
    const spec = Array.isArray(item) ? String(item[0] ?? "") : String(item)
    if (!spec || seen.has(spec)) return
    seen.add(spec)
    specs.push(item as string | [string, Record<string, unknown>])
  }

  const snapshot = await readSnapshot()
  if (snapshot) {
    for (const item of snapshot) add(item)
  } else {
    // Fallback: read configs directly when OpenCode has not written a runtime snapshot yet.
    for (const path of [
      join(globalDir, "opencode.jsonc"),
      join(globalDir, "opencode.json"),
      join(projectDir, "opencode.jsonc"),
      join(projectDir, "opencode.json"),
      join(projectDir, "tui.jsonc"),
      join(projectDir, "tui.json"),
    ]) {
      const cfg = await readConfig(path)
      if (!cfg) continue
      const list = cfg.plugin
      if (!Array.isArray(list)) continue
      for (const item of list) add(item)
    }
  }

  if (specs.length === 0) {
    console.log("No plugins found in OpenCode config files.")
    return
  }

  const ctrl = new AbortController()
  const sigint = () => ctrl.abort()
  process.on("SIGINT", sigint)

  const table = await buildStatusTable(specs, ctrl.signal)
  console.log(table)

  process.off("SIGINT", sigint)
}

main().catch((err) => {
  console.error(`[error] ${String(err)}`)
  process.exit(1)
})
