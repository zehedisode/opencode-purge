import { describe, expect, test } from "bun:test"
import { resolve } from "../src/resolve.js"
import type { PurgeConfig, RequestContext } from "../src/types.js"

const baseDir = "/virtual/project"

const anthropic: RequestContext = {
  provider: "anthropic/messages",
  model: "claude-3-5-sonnet",
  agent: "build",
}

function reader(files: Record<string, string> = {}) {
  return (path: string) => {
    const relative = path.startsWith(`${baseDir}/`) ? path.slice(baseDir.length + 1) : path
    return files[relative] ?? files[path]
  }
}

function run(config: PurgeConfig, options: {
  context?: RequestContext
  override?: string
  files?: Record<string, string>
} = {}) {
  return resolve({
    config,
    baseDir,
    context: options.context ?? anthropic,
    read: reader(options.files ?? {}),
    ...(options.override !== undefined ? { override: options.override } : {}),
  })
}

const config: PurgeConfig = {
  default: "fallback",
  profiles: [
    {
      id: "anthropic",
      system: "ANTHROPIC BODY",
      match: [{ provider: "anthropic/*" }],
    },
    {
      id: "sonnet",
      system: "SONNET BODY",
      match: [{ model: "claude-3-5-*" }],
    },
    {
      id: "builder",
      system: "BUILDER BODY",
      match: [{ agent: "build" }],
    },
    {
      id: "fallback",
      system: "FALLBACK BODY",
    },
  ],
}

describe("resolve priority chain", () => {
  test("session override beats a matching profile and the default", () => {
    const result = run(config, { override: "sonnet" })
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.profile.id).toBe("sonnet")
    expect(result.resolved.source).toBe("session")
    expect(result.resolved.text).toContain("SONNET BODY")
  })

  test('override "off" wins over everything', () => {
    expect(run(config, { override: "off" })).toEqual({ kind: "none", reason: "off" })
  })

  test("unknown override yields no-profile", () => {
    expect(run(config, { override: "ghost" })).toEqual({ kind: "none", reason: "no-profile" })
  })

  test("first matching profile wins for provider glob", () => {
    const result = run(config)
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.profile.id).toBe("anthropic")
    expect(result.resolved.source).toBe("match")
  })

  test("matches a model glob", () => {
    const onlyModel: PurgeConfig = { profiles: [config.profiles![1]!] }
    const result = run(onlyModel)
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.profile.id).toBe("sonnet")
  })

  test("matches an agent selector", () => {
    const onlyAgent: PurgeConfig = { profiles: [config.profiles![2]!] }
    expect(run(onlyAgent).kind).toBe("profile")
    expect(run(onlyAgent, { context: { ...anthropic, agent: "plan" } })).toEqual({
      kind: "none",
      reason: "no-profile",
    })
  })

  test("a selector with several fields must satisfy all of them", () => {
    const combined: PurgeConfig = {
      profiles: [
        {
          id: "combo",
          system: "COMBO",
          match: [{ provider: "anthropic/*", model: "claude-3-5-*", agent: "build" }],
        },
      ],
    }

    expect(run(combined).kind).toBe("profile")
    expect(run(combined, { context: { ...anthropic, agent: "plan" } })).toEqual({ kind: "none", reason: "no-profile" })
  })

  test("an empty `agents` restriction blocks the profile", () => {
    const restricted: PurgeConfig = {
      profiles: [{ id: "restricted", system: "NOPE", agents: [], match: [{ provider: "*" }] }],
    }

    expect(run(restricted)).toEqual({ kind: "none", reason: "no-profile" })
    // An explicit session override still bypasses selectors.
    expect(run(restricted, { override: "restricted" }).kind).toBe("profile")
  })

  test("an `agents` restriction blocks non-matching agents", () => {
    const restricted: PurgeConfig = {
      profiles: [{ id: "build-only", system: "X", agents: ["build"], match: [{ provider: "*" }] }],
    }

    expect(run(restricted).kind).toBe("profile")
    expect(run(restricted, { context: { ...anthropic, agent: "plan" } })).toEqual({
      kind: "none",
      reason: "no-profile",
    })
  })

  test("disabled profiles are skipped during matching", () => {
    const disabled: PurgeConfig = {
      profiles: [
        { id: "off-one", enabled: false, system: "NO", match: [{ provider: "*" }] },
        { id: "next", system: "YES", match: [{ provider: "*" }] },
      ],
    }

    const result = run(disabled)
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.profile.id).toBe("next")
  })

  test("overriding to a disabled profile yields reason disabled", () => {
    const disabled: PurgeConfig = {
      profiles: [{ id: "off-one", enabled: false, system: "NO", match: [{ provider: "*" }] }],
    }

    expect(run(disabled, { override: "off-one" })).toEqual({ kind: "none", reason: "disabled" })
  })

  test("default is used when nothing matches", () => {
    const result = run(config, { context: { provider: "openai", model: "gpt-4", agent: "general" } })
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.profile.id).toBe("fallback")
    expect(result.resolved.source).toBe("default")
  })

  test("a disabled default is not used", () => {
    const disabledDefault: PurgeConfig = {
      default: "fallback",
      profiles: [{ id: "fallback", enabled: false, system: "NO" }],
    }
    expect(run(disabledDefault, { context: { provider: "openai", model: "gpt-4", agent: "general" } })).toEqual({
      kind: "none",
      reason: "no-profile",
    })
  })

  test("no profiles at all yields no-config", () => {
    expect(run({ profiles: [] }, { override: "off" })).toEqual({ kind: "none", reason: "no-config" })
    expect(run({})).toEqual({ kind: "none", reason: "no-config" })
    expect(run({ default: "x" })).toEqual({ kind: "none", reason: "no-config" })
  })
})

describe("render", () => {
  test("orders marker, system body and rule bodies", () => {
    const withRules: PurgeConfig = {
      profiles: [
        {
          id: "rich",
          system: "SYSTEM BODY",
          rules: ["rules/first.md", "rules/second.md"],
          match: [{ provider: "*" }],
        },
      ],
    }

    const result = run(withRules, {
      files: { "rules/first.md": "FIRST RULE\n", "rules/second.md": "SECOND RULE" },
    })
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")

    const { text, rules, chars } = result.resolved
    expect(text).toContain('<!-- opencode-purge:profile id="rich" source="match" -->')
    expect(text.indexOf("SYSTEM BODY")).toBeGreaterThan(text.indexOf("opencode-purge:profile"))
    expect(text.indexOf("FIRST RULE")).toBeGreaterThan(text.indexOf("SYSTEM BODY"))
    expect(text.indexOf("SECOND RULE")).toBeGreaterThan(text.indexOf("FIRST RULE"))
    expect(text).toContain('<!-- opencode-purge:rule path="rules/first.md" -->')
    expect(rules).toEqual([
      { path: "rules/first.md", chars: "FIRST RULE".length },
      { path: "rules/second.md", chars: "SECOND RULE".length },
    ])
    expect(chars).toBe(text.length)
  })

  test("a missing rule file is skipped, not fatal", () => {
    const withRules: PurgeConfig = {
      profiles: [{ id: "sparse", system: "BODY", rules: ["rules/missing.md", "rules/present.md"] }],
    }

    const result = run(withRules, {
      override: "sparse",
      files: { "rules/present.md": "PRESENT" },
    })
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")

    expect(result.resolved.text).toContain("PRESENT")
    expect(result.resolved.text).not.toContain("missing.md")
    expect(result.resolved.rules).toEqual([{ path: "rules/present.md", chars: "PRESENT".length }])
  })

  test("empty rule files are skipped", () => {
    const withRules: PurgeConfig = {
      profiles: [{ id: "empty-rule", system: "BODY", rules: ["rules/blank.md"] }],
    }

    const result = run(withRules, { override: "empty-rule", files: { "rules/blank.md": "  \n\t" } })
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.rules).toEqual([])
    expect(result.resolved.text).not.toContain("opencode-purge:rule")
  })

  test("a profile with no body renders only the marker", () => {
    const result = run({ profiles: [{ id: "marker-only" }] }, { override: "marker-only" })
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.text).toBe('<!-- opencode-purge:profile id="marker-only" source="session" -->')
  })

  test("systemFile resolves relative to baseDir", () => {
    const seen: string[] = []
    const withFile: PurgeConfig = {
      profiles: [{ id: "file", systemFile: "prompts/system.md" }],
    }

    const result = resolve({
      config: withFile,
      baseDir,
      override: "file",
      context: anthropic,
      read: (path) => {
        seen.push(path)
        return path === `${baseDir}/prompts/system.md` ? "FROM FILE" : undefined
      },
    })

    expect(seen).toEqual([`${baseDir}/prompts/system.md`])
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.text).toContain("FROM FILE")
    expect(result.resolved.source).toBe("session")
  })

  test("absolute rule paths are passed through unchanged", () => {
    const seen: string[] = []
    const absolute: PurgeConfig = {
      profiles: [{ id: "abs", system: "BODY", rules: ["/etc/purge/rule.md"] }],
    }

    const result = resolve({
      config: absolute,
      baseDir,
      override: "abs",
      context: anthropic,
      read: (path) => {
        seen.push(path)
        return "ABS RULE"
      },
    })

    expect(seen).toEqual(["/etc/purge/rule.md"])
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.text).toContain("ABS RULE")
  })

  test("system wins over systemFile if both are present at runtime", () => {
    const both: PurgeConfig = {
      profiles: [{ id: "both", system: "INLINE", systemFile: "prompts/system.md" }],
    }

    const result = run(both, { override: "both", files: { "prompts/system.md": "FILE" } })
    expect(result.kind).toBe("profile")
    if (result.kind !== "profile") throw new Error("expected profile")
    expect(result.resolved.text).toContain("INLINE")
    expect(result.resolved.text).not.toContain("FILE")
  })
})
