import type { AuditEntry, Issue, Profile, PurgeConfig, RequestContext, Resolution } from "./types.js"

export interface StatusInput {
  configPath: string | null
  override: string | undefined
  resolution: Resolution
  context: RequestContext
  config: PurgeConfig
  session: string
}

export function formatStatus(input: StatusInput): string {
  const lines: string[] = []
  const override = input.override
  lines.push("opencode-purge · status")
  lines.push("")
  lines.push(`config     ${input.configPath ?? "(none found)"}`)
  lines.push(`session    ${short(input.session)}`)
  lines.push(`call       ${input.context.provider}/${input.context.model} · agent ${input.context.agent}`)
  lines.push(`override   ${override ? override : "(automatic)"}`)
  lines.push(`guard      ${guardSummary(input.config)}`)

  const resolution = input.resolution
  if (resolution.kind === "profile") {
    const resolved = resolution.resolved
    lines.push(`resolved   ${resolved.profile.id}  (${sourceLabel(resolved.source)}, ${resolved.chars} chars)`)
    if (resolved.rules.length > 0) {
      const rules = resolved.rules.map((rule) => `${rule.path} (${rule.chars})`).join(", ")
      lines.push(`rules      ${rules}`)
    }
  } else {
    lines.push(`resolved   nothing injected — ${reasonLabel(resolution.reason)}`)
  }

  lines.push("")
  lines.push(`profiles   ${input.config.profiles?.length ?? 0} configured`)
  return lines.join("\n")
}

export function formatProfiles(config: PurgeConfig): string {
  const profiles = config.profiles ?? []
  if (profiles.length === 0) return "No profiles configured. Create one in purge.jsonc."

  const idWidth = Math.max(4, ...profiles.map((profile) => profile.id.length))
  const lines = ["opencode-purge · profiles", ""]

  for (const profile of profiles) {
    const flags: string[] = []
    if (config.default === profile.id) flags.push("default")
    if (profile.enabled === false) flags.push("disabled")
    if (profile.match?.length) flags.push(`match:${profile.match.length}`)
    lines.push(`  ${profile.id.padEnd(idWidth)}  ${describe(profile)}${flags.length ? `  [${flags.join(", ")}]` : ""}`)
  }

  lines.push("")
  lines.push("Use /purge use <id> or the purge_use tool to switch this session.")
  return lines.join("\n")
}

export function formatDoctor(configPath: string | null, issues: readonly Issue[]): string {
  const lines = ["opencode-purge · doctor", "", `config     ${configPath ?? "(none found)"}`, ""]

  const errors = issues.filter((issue) => issue.level === "error")
  const warnings = issues.filter((issue) => issue.level === "warn")

  if (issues.length === 0) {
    lines.push("ok — no problems found")
    return lines.join("\n")
  }

  for (const issue of errors) lines.push(`error  ${issue.message}${issue.hint ? `  (${issue.hint})` : ""}`)
  for (const issue of warnings) lines.push(`warn   ${issue.message}${issue.hint ? `  (${issue.hint})` : ""}`)
  lines.push("")
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s)`)
  return lines.join("\n")
}

export function formatLog(entries: readonly AuditEntry[]): string {
  if (entries.length === 0) return "opencode-purge · log\n\nNo injections recorded yet."

  const lines = ["opencode-purge · log", ""]
  for (const entry of entries) {
    const profile = entry.profile ?? "—"
    const rules = entry.rules > 0 ? ` · ${entry.rules} rule(s)` : ""
    lines.push(
      `${entry.at.slice(11, 19)}  ${profile.padEnd(14)}  ${entry.provider}/${entry.model}  ${entry.chars}${rules}  ${short(entry.session)}`,
    )
  }
  return lines.join("\n")
}

function describe(profile: Profile): string {
  const parts: string[] = []
  if (profile.system !== undefined) parts.push("inline system")
  if (profile.systemFile !== undefined) parts.push(profile.systemFile)
  if (profile.rules?.length) parts.push(`${profile.rules.length} rule(s)`)
  if (parts.length === 0) parts.push("empty")
  return parts.join(" + ")
}

function guardSummary(config: PurgeConfig): string {
  const mode = config.guard?.mode ?? "off"
  if (mode === "off") return "off"
  const deny = config.guard?.deny?.length ?? 0
  const allow = config.guard?.allow?.length ?? 0
  return `${mode} (${deny} denied, ${allow} allowed)`
}

function sourceLabel(source: "session" | "match" | "default"): string {
  if (source === "session") return "session override"
  if (source === "match") return "selector match"
  return "default"
}

function reasonLabel(reason: "off" | "no-profile" | "disabled" | "no-config"): string {
  if (reason === "off") return "turned off for this session"
  if (reason === "disabled") return "the selected profile is disabled"
  if (reason === "no-config") return "no profiles in config"
  return "no profile matched and no default is set"
}

function short(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id
}
