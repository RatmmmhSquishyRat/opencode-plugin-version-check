# opencode-plugin-version-check

OpenCode plugin for checking installed plugin versions against the latest npm
releases.

## Features

- Shows a startup TUI notification when pinned npm plugins are outdated.
- Writes a runtime plugin snapshot so the CLI can report the full active plugin list.
- Provides a `plugin_status` server tool for AI invocation.
- Provides local CLI scripts for status reporting and safe global-config upgrades.

## Installation

Install as a remote OpenCode plugin after the package is published to npm:

```bash
opencode plugin @ratteeth1/opencode-plugin-version-check@latest
```

For global installation:

```bash
opencode plugin @ratteeth1/opencode-plugin-version-check@latest --global
```

OpenCode resolves the TUI plugin through the package `./tui` export and the
server tool through the `./server` export.

## CLI

From a cloned repository:

```bash
npm run plugin-status
npm run plugin-upgrade -- --dry-run
npm run plugin-upgrade -- --all --dry-run
```

From an installed npm package, the package exposes these binaries:

```bash
opencode-plugin-status --project <project-root>
opencode-plugin-upgrade --all --dry-run
```

`plugin-upgrade` creates a timestamped backup of the global OpenCode config
before writing changes.

## Server tool

### `plugin_status`

Lists OpenCode plugins showing the installed cache version, latest npm release,
release date, and status.

## License

MIT
