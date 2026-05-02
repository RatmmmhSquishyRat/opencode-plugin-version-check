# Session Log — 2026-05-03

## Background

Investigated OpenCode's plugin `@latest` auto-update mechanism and found it broken.
`Npm.add()` in `packages/core/src/npm.ts:123` checks only directory existence —
once a plugin is cached, it never re-checks the registry for newer versions.

## Plugin: opencode-plugin-version-check

### Architecture

```
src/
├── shared.ts      # parsePinnedSpec, parseNpmSpec, isNewer, formatDate,
│                  # fetchLatestVersion, buildStatusTable
├── index.ts       # TUI entry: startup toast + /plugin_status slash command
└── commands.ts    # Server entry: plugin_status tool for AI invocation
```

### Two entry points (package.json exports):

| Export        | File          | Purpose                                              |
|---------------|---------------|------------------------------------------------------|
| `./tui`       | `src/index.ts`| Startup auto-check (skips @latest) + `/plugin_status`|
| `./server`    | `src/commands.ts` | `plugin_status` tool for AI invocation            |

### Behavior

- **Startup (TUI)**: scans `tuiConfig.plugin` for pinned versions, queries npm
  registry, shows toast for outdated entries. `@latest` entries silent.
- **`/plugin_status` (TUI slash command)**: full table of ALL plugins (including
  @latest resolved). Runs once per selection.
- **`plugin_status` tool (server)**: same full table, invokable by AI agent.
- **Release date**: fetched from npm packument `time[version]`, formatted as
  `YYYY-MM-DD`. Column shown in both toast and table.

### Design decisions

- Zero external dependencies — built-in `fetch` + `AbortController` only.
- No `import type` from `@opencode-ai/plugin` — avoids runtime resolution
  failures when loaded as a standalone file plugin.
- `parsePinnedSpec` (TUI startup) skips @latest; `parseNpmSpec` (slash/tool)
  includes it. Both in shared.ts.
- `buildStatusTable` shared by both TUI slash command and server tool.
- KV guard (`plugin-version-check:last-run`) prevents duplicate startup checks.
- Config read from `config()` hook (server) or `api.tuiConfig.plugin` (TUI).
- npm registry queries use full packument endpoint for `dist-tags.latest` +
  `time[]` metadata. 8s timeout per request.

### Known limitations

- Full packument responses may be large for packages with many versions.
- Private/scoped registries not tested.
- Toast displays raw markdown (no rendering) — acceptable for now.
