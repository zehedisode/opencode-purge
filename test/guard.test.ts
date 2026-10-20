import { describe, expect, test } from "bun:test"
import { decide, hostOf, isLoopback } from "../src/guard.js"

describe("decide", () => {
  test("mode off skips and no guard skips", () => {
    expect(decide({ mode: "off" }, "api.anthropic.com")).toEqual({ action: "skip" })
    expect(decide({}, "api.anthropic.com")).toEqual({ action: "skip" })
    expect(decide(undefined, "api.anthropic.com")).toEqual({ action: "skip" })
  })

  test("deny matches block", () => {
    const guard = { mode: "deny" as const, deny: ["*.telemetry.test", "tracker.test"] }
    expect(decide(guard, "events.telemetry.test")).toEqual({ action: "block", reason: "denylist" })
    expect(decide(guard, "tracker.test")).toEqual({ action: "block", reason: "denylist" })
    expect(decide(guard, "api.anthropic.com")).toEqual({ action: "allow", reason: "not listed" })
  })

  test("allow overrides deny", () => {
    const guard = { mode: "deny" as const, deny: ["*"], allow: ["api.anthropic.com"] }
    expect(decide(guard, "api.anthropic.com")).toEqual({ action: "allow", reason: "allowlist" })
    expect(decide(guard, "api.openai.com")).toEqual({ action: "block", reason: "denylist" })
  })

  test("allow mode blocks unlisted hosts", () => {
    const guard = { mode: "allow" as const, allow: ["api.anthropic.com", "*.allowed.test"] }
    expect(decide(guard, "api.anthropic.com")).toEqual({ action: "allow", reason: "allowlist" })
    expect(decide(guard, "cdn.allowed.test")).toEqual({ action: "allow", reason: "allowlist" })
    expect(decide(guard, "api.openai.com")).toEqual({ action: "block", reason: "not in allowlist" })
  })

  test("loopback is never blocked", () => {
    for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]", "0.0.0.0"]) {
      expect(decide({ mode: "allow", allow: [] }, host)).toEqual({ action: "allow", reason: "loopback" })
      expect(decide({ mode: "deny", deny: ["*"] }, host)).toEqual({ action: "allow", reason: "loopback" })
    }
  })
})

describe("hostOf", () => {
  test("lowercases the hostname", () => {
    expect(hostOf("https://API.Anthropic.COM/v1/messages")).toBe("api.anthropic.com")
    expect(hostOf("http://localhost:11434/api/generate")).toBe("localhost")
  })

  test("returns undefined for an invalid URL", () => {
    expect(hostOf("not a url")).toBeUndefined()
    expect(hostOf("")).toBeUndefined()
    expect(hostOf("://missing-scheme")).toBeUndefined()
  })
})

describe("isLoopback", () => {
  test("recognises loopback forms", () => {
    expect(isLoopback("localhost")).toBe(true)
    expect(isLoopback("LOCALHOST")).toBe(true)
    expect(isLoopback("127.0.0.1")).toBe(true)
    expect(isLoopback("::1")).toBe(true)
    expect(isLoopback("example.com")).toBe(false)
  })
})
