import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { parseJsonc } from "./jsonc.js"
import type { Issue, LoadedConfig, Profile, PurgeConfig } from "./types.js"

const CANDIDATES = [".opencode/purge.jsonc", ".opencode/purge.json", "purge.jsonc", "purge.json"]

/** How long a config is trusted before the file is re-stat'ed. */
const RELOAD_TTL_MS = 1_000

export interface ConfigStoreOptions {
  /** Usually `ctx.location.directory`. */
  directory: string
  /** Explicit config path from plugin options, relative to `directory`. */
  explicit?: string
  /** Set to `false` to skip the user-level config directory. */
  global?: boolean
}

export interface ConfigStore {
  get(): LoadedConfig
  invalidate(): void
}

export function createConfigStore(options: ConfigStoreOptions): ConfigStore {
  let cached: LoadedConfig | undefined
  let checkedAt = 0

  const load = (): LoadedConfig => {
    const path = discover(options)
    if (!path) return { path: null, config: { profiles: [] }, issues: [], mtimeMs: 0 }
    try {
      const mtimeMs = statSync(path).mtimeMs
      const text = readFileSync(path, "utf8")
      const { config, issues } = validate(parseJsonc(text))
      return { path, config, issues, mtimeMs }
    } catch (error) {
      return {
        path,
        config: { profiles: [] },
        issues: [{ level: "error", message: `cannot read config: ${(error as Error).message}` }],
        mtimeMs: 0,
      }
    }
  }

  return {
    get() {
      if (!cached) {
        cached = load()
        checkedAt = Date.now()
        return cached
      }
      if (Date.now() - checkedAt < RELOAD_TTL_MS) return cached
      checkedAt = Date.now()
      const current = cached.path ? safeMtime(cached.path) : 0
      if (current !== cached.mtimeMs) cached = load()
      return cached
    },
    invalidate() {
      cached = undefined
      checkedAt = 0
    },
  }
}

function safeMtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

export function discover(options: ConfigStoreOptions): string | null {
  if (options.explicit) {
    const explicit = isAbsolute(options.explicit) ? options.explicit : resolve(options.directory, options.explicit)
    if (existsSync(explicit)) return explicit
  }

  let directory = resolve(options.directory)
  for (;;) {
    for (const candidate of CANDIDATES) {
      const path = join(directory, candidate)
      if (existsSync(path)) return path
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  if (options.global !== false) {
    const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
    for (const candidate of ["purge.jsonc", "purge.json"]) {
      const path = join(base, "opencode", candidate)
      if (existsSync(path)) return path
    }
  }

  return null
}

export function validate(input: unknown): { config: PurgeConfig; issues: Issue[] } {
  const issues: Issue[] = []
  const config: PurgeConfig = { profiles: [] }

  if (!isRecord(input)) {
    issues.push({ level: "error", message: "config must be a JSON object" })
    return { config, issues }
  }

  if (input.version !== undefined) {
    if (typeof input.version !== "number") issues.push({ level: "error", message: "`version` must be a number" })
    else if (input.version !== 1) issues.push({ level: "warn", message: `unknown config version ${input.version}`, hint: "this build understands version 1" })
  }

  if (input.default === null) config.default = null
  else if (input.default !== undefined) {
    if (typeof input.default !== "string") issues.push({ level: "error", message: "`default` must be a profile id or null" })
    else config.default = input.default
  }

  if (input.profiles !== undefined) {
    if (!Array.isArray(input.profiles)) issues.push({ level: "error", message: "`profiles` must be an array" })
    else {
      const seen = new Set<string>()
      for (const [index, raw] of input.profiles.entries()) {
        const profile = validateProfile(raw, `profiles[${index}]`, issues)
        if (!profile) continue
        if (seen.has(profile.id)) {
          issues.push({ level: "error", message: `duplicate profile id "${profile.id}"`, hint: "ids must be unique; the first one wins" })
          continue
        }
        seen.add(profile.id)
        config.profiles!.push(profile)
      }
    }
  }

  if (config.default && config.profiles!.length > 0 && !config.profiles!.some((profile) => profile.id === config.default)) {
    issues.push({ level: "warn", message: `default profile "${config.default}" is not defined` })
  }

  if (input.guard !== undefined) {
    if (!isRecord(input.guard)) issues.push({ level: "error", message: "`guard` must be an object" })
    else {
      const mode = input.guard.mode
      if (mode !== undefined && mode !== "off" && mode !== "deny" && mode !== "allow") {
        issues.push({ level: "error", message: '`guard.mode` must be "off", "deny" or "allow"' })
      } else {
        config.guard = {
          mode: (mode as "off" | "deny" | "allow" | undefined) ?? "off",
          deny: stringList(input.guard.deny, "guard.deny", issues) ?? [],
          allow: stringList(input.guard.allow, "guard.allow", issues) ?? [],
        }
      }
    }
  }

  if (input.audit !== undefined) {
    if (!isRecord(input.audit)) issues.push({ level: "error", message: "`audit` must be an object" })
    else {
      const enabled = input.audit.enabled
      const max = input.audit.max
      if (enabled !== undefined && typeof enabled !== "boolean") issues.push({ level: "error", message: "`audit.enabled` must be a boolean" })
      if (max !== undefined && (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 5000)) {
        issues.push({ level: "error", message: "`audit.max` must be an integer between 1 and 5000" })
      } else {
        config.audit = {
          enabled: typeof enabled === "boolean" ? enabled : true,
          max: typeof max === "number" ? max : 200,
        }
      }
    }
  }

  return { config, issues }
}

function validateProfile(raw: unknown, where: string, issues: Issue[]): Profile | null {
  if (!isRecord(raw)) {
    issues.push({ level: "error", message: `${where} must be an object` })
    return null
  }

  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    issues.push({ level: "error", message: `${where}.id is required` })
    return null
  }

  const profile: Profile = { id: raw.id.trim() }

  if (raw.name !== undefined) {
    if (typeof raw.name !== "string") issues.push({ level: "error", message: `${where}.name must be a string` })
    else profile.name = raw.name
  }

  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") issues.push({ level: "error", message: `${where}.description must be a string` })
    else profile.description = raw.description
  }

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") issues.push({ level: "error", message: `${where}.enabled must be a boolean` })
    else profile.enabled = raw.enabled
  }

  if (raw.system !== undefined) {
    if (typeof raw.system !== "string") issues.push({ level: "error", message: `${where}.system must be a string` })
    else profile.system = raw.system
  }

  if (raw.systemFile !== undefined) {
    if (typeof raw.systemFile !== "string") issues.push({ level: "error", message: `${where}.systemFile must be a string` })
    else profile.systemFile = raw.systemFile
  }

  if (profile.system !== undefined && profile.systemFile !== undefined) {
    issues.push({ level: "error", message: `${where} sets both \`system\` and \`systemFile\``, hint: "pick one" })
  }

  if (profile.system === undefined && profile.systemFile === undefined && profile.rules === undefined) {
    issues.push({ level: "warn", message: `${where} injects nothing`, hint: "add `system`, `systemFile` or `rules`" })
  }

  const rules = stringList(raw.rules, `${where}.rules`, issues)
  if (rules) profile.rules = rules

  const agents = stringList(raw.agents, `${where}.agents`, issues)
  if (agents) profile.agents = agents

  if (raw.match !== undefined) {
    if (!Array.isArray(raw.match)) issues.push({ level: "error", message: `${where}.match must be an array` })
    else {
      const matches = []
      for (const [index, entry] of raw.match.entries()) {
        if (!isRecord(entry)) {
          issues.push({ level: "error", message: `${where}.match[${index}] must be an object` })
          continue
        }
        const parsed: { provider?: string; model?: string; agent?: string } = {}
        let valid = true
        for (const key of ["provider", "model", "agent"] as const) {
          const value = entry[key]
          if (value === undefined) continue
          if (typeof value !== "string") {
            issues.push({ level: "error", message: `${where}.match[${index}].${key} must be a string` })
            valid = false
            continue
          }
          parsed[key] = value
        }
        if (valid && Object.keys(parsed).length > 0) matches.push(parsed)
      }
      if (matches.length > 0) profile.match = matches
    }
  }

  return profile
}

function stringList(value: unknown, where: string, issues: Issue[]): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    issues.push({ level: "error", message: `${where} must be an array of strings` })
    return undefined
  }
  const output: string[] = []
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") issues.push({ level: "error", message: `${where}[${index}] must be a string` })
    else output.push(entry)
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
