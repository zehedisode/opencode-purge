/**
 * Public configuration and resolution types for opencode-purge.
 *
 * Nothing in here talks to OpenCode directly; the plugin runtime lives in
 * `index.ts` and everything else is pure so it can be unit tested.
 */

export type ProfileId = string

/** Glob-ish selector. `*` matches any run of characters, matching is case-insensitive. */
export interface ProfileMatch {
  provider?: string
  model?: string
  agent?: string
}

export interface Profile {
  id: ProfileId
  name?: string
  description?: string
  /** Defaults to `true`. Disabled profiles never resolve, but stay configurable. */
  enabled?: boolean
  /** Inline system prompt body. */
  system?: string
  /** File containing the system prompt body, relative to the config file. */
  systemFile?: string
  /** Extra markdown files appended after the system body, in order. */
  rules?: string[]
  /** Auto-activation selectors. The first matching profile wins. */
  match?: ProfileMatch[]
  /** Restricts the profile to these agent ids (glob). */
  agents?: string[]
}

export interface GuardConfig {
  /** `off` (default) never inspects traffic. */
  mode?: "off" | "deny" | "allow"
  /** Hosts to block in `deny` mode. Supports `*`. */
  deny?: string[]
  /** Hosts to re-allow in `deny` mode. Supports `*`. */
  allow?: string[]
}

export interface AuditConfig {
  enabled?: boolean
  /** Ring buffer size. Defaults to 200. */
  max?: number
}

export interface PurgeConfig {
  version?: number
  /** Profile applied when nothing else matches. `null` disables the fallback. */
  default?: ProfileId | null
  profiles?: Profile[]
  guard?: GuardConfig
  audit?: AuditConfig
}

export interface Issue {
  level: "error" | "warn"
  message: string
  hint?: string
}

export interface LoadedConfig {
  /** Absolute path of the config file, or `null` when nothing was found. */
  path: string | null
  config: PurgeConfig
  issues: Issue[]
  mtimeMs: number
}

export interface RulePart {
  /** Path as written in the config. */
  path: string
  chars: number
}

export interface ResolvedProfile {
  profile: Profile
  source: "session" | "match" | "default"
  text: string
  rules: RulePart[]
  chars: number
}

export type Resolution =
  | { kind: "none"; reason: "off" | "no-profile" | "disabled" | "no-config" }
  | { kind: "profile"; resolved: ResolvedProfile }

export interface AuditEntry {
  at: string
  session: string
  agent: string
  provider: string
  model: string
  profile: string | null
  source: string | null
  rules: number
  chars: number
}

/** The slice of a model call that profile selectors are matched against. */
export interface RequestContext {
  provider: string
  model: string
  agent: string
}
