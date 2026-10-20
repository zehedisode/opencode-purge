# Architecture

`opencode-purge` is a single OpenCode plugin with no runtime dependencies. This document explains the moving parts so the code stays easy to audit.

## Module map

```
src/
  index.ts     plugin wiring: hooks, tools, commands, session overrides
  config.ts    discovery, JSONC parsing, validation, hot reload
  resolve.ts   pure profile resolution and rendering
  report.ts    plain-text formatters for status/doctor/log/profiles
  guard.ts     pure outbound-host decision
  audit.ts     ring buffer over plugin storage
  glob.ts      `*` matcher
  jsonc.ts     dependency-free JSONC reader
  types.ts     config and resolution types
```

Only `index.ts` imports anything from OpenCode, and only as a type. Everything else is pure, takes its inputs as arguments, and is unit tested without a running host.

## Lifecycle

```
setup(ctx)
  ├─ createConfigStore(directory, options)     // cached, TTL 1s
  ├─ loadOverrides()                           // from ctx.storage
  ├─ session.hook("context")                   // profile injection
  ├─ session.hook("http.request")              // host guard (off by default)
  ├─ tool.transform(editor => add 4 tools)
  ├─ command.transform(editor => add 5 commands)
  └─ return cleanup → dispose every registration
```

`setup` never throws on a bad config. A malformed file yields zero profiles and a warning; the plugin stays inert instead of taking the session down with it.

## Request path

For every model call the host assembles a system prompt and then runs the `context` hook:

1. Read the cached config. If the file's mtime moved, re-read and re-validate.
2. Resolve the session override from an in-memory map (backed by plugin storage).
3. Run the priority chain: `override` → first `match` → `default` → nothing.
4. Render the profile: marker comment, system body, one block per rule file.
5. Skip if a marker is already present in the request.
6. Push one `SystemPart` and record an audit entry.

The hook is wrapped so that any failure returns silently. Prompt injection is an enhancement; it must never be the reason a request fails.

## Why the marker

Every injected block starts with an HTML comment naming the profile and its source:

```html
<!-- opencode-purge:profile id="reviewer" source="match" -->
```

It makes two things possible: idempotence without a content hash, and a grep-able trail when you are reading a request dump to work out why a model behaved a certain way. Rule blocks carry their own marker with the path as written in the config.

## Resolution is pure

`resolve()` receives the config, a base directory, an override, the request context and a `read` function. It returns either `{kind:"none", reason}` or `{kind:"profile", resolved}`. No I/O, no host types, no clock.

That is what makes the priority chain testable in isolation, and it is the part most likely to grow — keeping it pure means new selectors can be added without touching the request path.

## Session overrides

`/purge use` and the `purge_use` tool write to a `Map<sessionID, profileID | "off">` and persist it to plugin storage under `overrides`. The map is bounded to 500 entries, dropping the oldest, so a long-lived service does not accumulate state forever.

Storage is best effort: if it is unavailable, overrides still work for the lifetime of the process.

## Host guard

The guard is a pure function, `decide(guardConfig, hostname) → skip | allow | block`. `index.ts` resolves the hostname and raises an error only on `block`. Loopback is unconditionally allowed so that a wrong `deny` pattern cannot cut off a local model server.

This is the only part that can abort work, which is why it defaults to `off` and is documented as experimental.

## Failure model

| Failure | Behaviour |
| --- | --- |
| Config missing | plugin registers, injects nothing |
| Config malformed | zero profiles, warning at setup, `/purge doctor` explains |
| Rule file missing | that rule is skipped, the profile still applies |
| Storage unavailable | overrides live in memory only |
| Hook throws | swallowed; the request proceeds unprompted |

## Build

`bun build src/index.ts --target node --format esm` produces a single `dist/index.js`. Because the only runtime imports are `node:fs`, `node:path` and `node:os`, the artifact is self-contained and does not need `@opencode/plugin` at runtime — it is a type-only import, erased at build time.

Declarations are emitted by `tsc --emitDeclarationOnly`.
