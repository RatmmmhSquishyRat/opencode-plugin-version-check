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
│                  # fetchLatestVersion, buildOutdatedPinnedRows, buildStatusTable
├── index.ts       # TUI entry: startup toast + runtime plugin snapshot
└── commands.ts    # Server entry: plugin_status tool for AI invocation

scripts/
└── plugin-status.ts  # Standalone CLI — reads runtime snapshot, prints status table to stdout

test/
└── shared.test.ts    # Installed/latest table behavior tests
```

### Entry points

| Entry             | File                     | Purpose                                         |
|-------------------|--------------------------|-------------------------------------------------|
| `./tui`           | `src/index.ts`           | Startup toast + final runtime plugin-list snapshot |
| `./server`        | `src/commands.ts`        | `plugin_status` tool for AI invocation          |
| `npm run plugin-status` | `scripts/plugin-status.ts` | User-run CLI: prints markdown table to stdout |

### Behavior

- **Startup (TUI)**: scans configured plugins for pinned versions, queries npm
  registry, shows toast for outdated entries. `@latest` entries silent.
- **Runtime snapshot (TUI)**: on OpenCode startup, reads the process-visible
  final plugin lists from `api.state.config.plugin` and `api.tuiConfig.plugin`,
  dedupes by package name/file spec, and writes
  `~/.local/state/opencode/plugin-version-check/plugins.json`.
- **`npm run plugin-status` (CLI)**: reads the runtime snapshot first. If no
  snapshot exists, falls back to direct config reads. Prints a compact markdown
  table with only `Installed`, `Latest Released`, and `Status`.
- **`plugin_status` tool (server)**: same full table, invokable by AI agent.
- **Startup outdated helper**: `buildOutdatedPinnedRows` is tested directly;
  it only returns pinned plugins where npm latest is newer, ignores `@latest`,
  and isolates registry failures so one failed package does not suppress other
  outdated notifications.

### Why no slash command

The `/plugin_status` slash command was removed because:

1. TUI plugin API `api.client.session.prompt({ noReply: true })` produces
   poorly formatted text in the session — options like `noReply`, `parts`,
   `sessionID` etc. do not reliably produce clean user-visible output in
   the current OpenCode version.
2. The standalone CLI script (`npm run plugin-status`) gives full control
   over output formatting and can be bound to any npm command or alias.
3. The AI-invokable server `plugin_status` tool remains for agent use.

### Design decisions

- Zero external dependencies — built-in `fetch` + `AbortController` only.
- No `import type` from `@opencode-ai/plugin` — avoids runtime resolution
  failures when loaded as a standalone file plugin.
- `parseNpmSpec` classifies pinned vs @latest entries. Startup uses
  `buildOutdatedPinnedRows`, so only pinned entries can trigger notifications.
- CLI status does not show configured values. It reads installed versions from
  OpenCode's plugin cache node_modules:
  `~/.cache/opencode/packages/<sanitized-spec>/node_modules/<pkg>/package.json`.
- Git/package URL specs are excluded from registry comparison because npm
  registry latest for the alias package name is unrelated to the git target.
- `buildStatusTable` shared by CLI script and server tool.
- Config read from `config()` hook (server) or `api.state.config.plugin` +
  `api.tuiConfig.plugin` (TUI). CLI script prefers the TUI-written snapshot.
- npm registry queries use full packument endpoint for `dist-tags.latest` +
  `time[]` metadata. 8s timeout per request.
- JSONC parser handles `//` comments, `/* */` blocks, string escape sequences,
  and trailing commas.

### Known limitations

- Full packument responses may be large for packages with many versions.
- Private/scoped registries not tested.
- Toast displays raw markdown (no rendering) — acceptable for now.
- CLI script depends on `bun` runtime (Bun.file, Bun's native TS support).
- Runtime snapshot exists only after OpenCode has started with this TUI plugin;
  before that, CLI falls back to config-file reading.
