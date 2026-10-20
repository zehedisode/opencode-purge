import { describe, expect, test } from "bun:test"
import { validate } from "../src/config.js"
import type { Issue } from "../src/types.js"

const errors = (issues: Issue[]) => issues.filter((issue) => issue.level === "error")
const warns = (issues: Issue[]) => issues.filter((issue) => issue.level === "warn")

describe("validate", () => {
  test("parses a valid config", () => {
    const { config, issues } = validate({
      version: 1,
      default: "base",
      profiles: [
        {
          id: "base",
          name: "Base",
          system: "Be brief.",
          rules: ["rules/a.md"],
          agents: ["build", "plan"],
          match: [{ provider: "anthropic/*", model: "claude-*" }],
          enabled: true,
        },
      ],
      guard: { mode: "deny", deny: ["*.telemetry.test"], allow: ["localhost"] },
      audit: { enabled: true, max: 50 },
    })

    expect(issues).toEqual([])
    expect(config.default).toBe("base")
    expect(config.profiles).toHaveLength(1)
    expect(config.profiles?.[0]).toMatchObject({
      id: "base",
      name: "Base",
      system: "Be brief.",
      rules: ["rules/a.md"],
      agents: ["build", "plan"],
      enabled: true,
      match: [{ provider: "anthropic/*", model: "claude-*" }],
    })
    expect(config.guard).toEqual({ mode: "deny", deny: ["*.telemetry.test"], allow: ["localhost"] })
    expect(config.audit).toEqual({ enabled: true, max: 50 })
  })

  test("applies guard/audit defaults", () => {
    const { config } = validate({ profiles: [] })
    expect(config.guard).toBeUndefined()
    expect(config.audit).toBeUndefined()

    const guarded = validate({ guard: {}, audit: {} }).config
    expect(guarded.guard).toEqual({ mode: "off", deny: [], allow: [] })
    expect(guarded.audit).toEqual({ enabled: true, max: 200 })
  })

  test("missing id is an error", () => {
    const { config, issues } = validate({ profiles: [{ system: "no id" }] })
    expect(errors(issues).map((issue) => issue.message)).toContain("profiles[0].id is required")
    expect(config.profiles).toEqual([])
  })

  test("blank id is an error", () => {
    const { config, issues } = validate({ profiles: [{ id: "   ", system: "x" }] })
    expect(errors(issues).some((issue) => issue.message.includes("id is required"))).toBe(true)
    expect(config.profiles).toEqual([])
  })

  test("duplicate ids are an error and the first wins", () => {
    const { config, issues } = validate({
      profiles: [
        { id: "dup", system: "first" },
        { id: "dup", system: "second" },
      ],
    })

    expect(errors(issues).some((issue) => issue.message.includes('duplicate profile id "dup"'))).toBe(true)
    expect(config.profiles).toHaveLength(1)
    expect(config.profiles?.[0]?.system).toBe("first")
  })

  test("system and systemFile together is an error", () => {
    const { issues } = validate({
      profiles: [{ id: "both", system: "inline", systemFile: "prompts/system.md" }],
    })
    expect(errors(issues).some((issue) => issue.message.includes("both `system` and `systemFile`"))).toBe(true)
  })

  test("unknown default profile is a warning, not an error", () => {
    const { config, issues } = validate({
      default: "ghost",
      profiles: [{ id: "base", system: "x" }],
    })

    expect(errors(issues)).toEqual([])
    expect(warns(issues).map((issue) => issue.message)).toContain('default profile "ghost" is not defined')
    expect(config.default).toBe("ghost")
  })

  test("invalid guard.mode is an error and drops the guard", () => {
    const { config, issues } = validate({ guard: { mode: "block" } })
    expect(errors(issues).some((issue) => issue.message.includes("`guard.mode`"))).toBe(true)
    expect(config.guard).toBeUndefined()
  })

  test("guard.deny must be an array of strings", () => {
    const { issues } = validate({ guard: { mode: "deny", deny: "example.com" } })
    expect(errors(issues).some((issue) => issue.message.includes("guard.deny"))).toBe(true)
  })

  test("audit.max is bounded to 1..5000", () => {
    for (const max of [0, -1, 5001, 1.5, Number.NaN]) {
      const { issues } = validate({ audit: { max } })
      expect(errors(issues).some((issue) => issue.message.includes("`audit.max`"))).toBe(true)
    }

    expect(errors(validate({ audit: { max: 1 } }).issues)).toEqual([])
    expect(errors(validate({ audit: { max: 5000 } }).issues)).toEqual([])
    expect(validate({ audit: { max: 12 } }).config.audit).toEqual({ enabled: true, max: 12 })
  })

  test("audit.enabled must be a boolean", () => {
    const { issues } = validate({ audit: { enabled: "yes" } })
    expect(errors(issues).some((issue) => issue.message.includes("`audit.enabled`"))).toBe(true)
  })

  test("non-object input is an error", () => {
    for (const input of [null, undefined, "config", 42, [] as unknown]) {
      const { config, issues } = validate(input)
      expect(errors(issues).map((issue) => issue.message)).toContain("config must be a JSON object")
      expect(config.profiles).toEqual([])
    }
  })

  test("non-array profiles is an error", () => {
    const { issues } = validate({ profiles: { id: "base" } })
    expect(errors(issues).some((issue) => issue.message.includes("`profiles` must be an array"))).toBe(true)
  })

  test("profile.match entries are validated", () => {
    const { config, issues } = validate({
      profiles: [{ id: "bad", system: "x", match: [{ provider: 7 }, {}] }],
    })

    expect(errors(issues).some((issue) => issue.message.includes("match[0].provider must be a string"))).toBe(true)
    // Invalid selectors are dropped; an empty match list means "never auto-activates".
    expect(config.profiles?.[0]?.match).toBeUndefined()
  })
})
