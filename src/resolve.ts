import { isAbsolute, resolve as resolvePath } from "node:path"
import { matches } from "./glob.js"
import type { Profile, PurgeConfig, RequestContext, ResolvedProfile, Resolution, RulePart } from "./types.js"

export interface ResolveOptions {
  config: PurgeConfig
  /** Directory of the config file; `systemFile` and `rules` are relative to it. */
  baseDir: string
  /** Per-session override: a profile id, `"off"`, or `undefined` for automatic. */
  override?: string
  context: RequestContext
  /** Injected so resolution stays pure and testable. */
  read: (path: string) => string | undefined
}

/**
 * Priority chain:
 *
 *   session override  →  profile `match`  →  config `default`  →  nothing
 *
 * `"off"` is an explicit decision and outranks both `match` and `default`.
 */
export function resolve(options: ResolveOptions): Resolution {
  const profiles = options.config.profiles ?? []
  if (profiles.length === 0) return { kind: "none", reason: "no-config" }

  if (options.override === "off") return { kind: "none", reason: "off" }

  if (options.override) {
    const profile = profiles.find((entry) => entry.id === options.override)
    if (!profile) return { kind: "none", reason: "no-profile" }
    if (profile.enabled === false) return { kind: "none", reason: "disabled" }
    return { kind: "profile", resolved: render(profile, "session", options) }
  }

  for (const profile of profiles) {
    if (profile.enabled === false) continue
    if (!matchesProfile(profile, options.context)) continue
    return { kind: "profile", resolved: render(profile, "match", options) }
  }

  const fallbackId = options.config.default
  if (fallbackId) {
    const profile = profiles.find((entry) => entry.id === fallbackId)
    if (profile && profile.enabled !== false) {
      return { kind: "profile", resolved: render(profile, "default", options) }
    }
  }

  return { kind: "none", reason: "no-profile" }
}

export function matchesProfile(profile: Profile, context: RequestContext): boolean {
  // An explicit `agents` list is a restriction: an empty list allows no agent.
  if (profile.agents && !profile.agents.some((agent) => matches(agent, context.agent))) return false
  if (!profile.match || profile.match.length === 0) return false

  return profile.match.some((selector) => {
    if (selector.agent && !matches(selector.agent, context.agent)) return false
    if (selector.provider && !matches(selector.provider, context.provider)) return false
    if (selector.model && !matches(selector.model, context.model)) return false
    return true
  })
}

export function render(profile: Profile, source: ResolvedProfile["source"], options: ResolveOptions): ResolvedProfile {
  const blocks: string[] = [`<!-- opencode-purge:profile id="${profile.id}" source="${source}" -->`]

  const system = profile.system ?? (profile.systemFile ? options.read(assetPath(options.baseDir, profile.systemFile)) : undefined)
  if (system && system.trim() !== "") blocks.push(system.trim())

  const rules: RulePart[] = []
  for (const rulePath of profile.rules ?? []) {
    const text = options.read(assetPath(options.baseDir, rulePath))
    if (text === undefined) continue
    const trimmed = text.trim()
    if (trimmed === "") continue
    blocks.push(`<!-- opencode-purge:rule path="${rulePath}" -->\n${trimmed}`)
    rules.push({ path: rulePath, chars: trimmed.length })
  }

  const text = blocks.join("\n\n")
  return { profile, source, text, rules, chars: text.length }
}

export function assetPath(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : resolvePath(baseDir, path)
}
