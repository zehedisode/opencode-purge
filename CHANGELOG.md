# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-10-20

First release.

### Added

- Named prompt profiles with per-model, per-provider and per-agent selectors.
- Declarative resolution chain: session override → selector match → default.
- Rulesets: any number of markdown files appended to a profile in order.
- `purge_status`, `purge_use`, `purge_doctor` and `purge_log` tools.
- `/purge`, `/purge-profiles`, `/purge-off`, `/purge-doctor` and `/purge-log` commands.
- Session overrides persisted through plugin storage.
- Config discovery across project, `.opencode/` and user config directories,
  with one-second hot reload.
- JSONC support — comments and trailing commas.
- Outbound host guard (`off` by default), with loopback always allowed.
- Injection audit ring buffer.
- Zero runtime dependencies; the published artifact imports only `node:fs`,
  `node:path` and `node:os`.
