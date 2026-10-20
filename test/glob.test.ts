import { describe, expect, test } from "bun:test"
import { matches, matchesAny } from "../src/glob.js"

describe("matches", () => {
  test("exact match", () => {
    expect(matches("build", "build")).toBe(true)
    expect(matches("build", "buildx")).toBe(false)
  })

  test("whole-string match: a pattern is not a prefix test", () => {
    expect(matches("claude", "claude-3-5-sonnet")).toBe(false)
    expect(matches("anthropic/claude", "anthropic/claude-3")).toBe(false)
  })

  test("`*` wildcard spans any run of characters", () => {
    expect(matches("anthropic/*", "anthropic/claude-3-5")).toBe(true)
    expect(matches("anthropic/*", "openai/gpt-4")).toBe(false)
    expect(matches("claude-*", "claude-3-5")).toBe(true)
    expect(matches("*sonnet*", "claude-3-5-sonnet-latest")).toBe(true)
    expect(matches("gpt-*-mini", "gpt-4o-mini")).toBe(true)
  })

  test("bare `*` matches everything", () => {
    expect(matches("*", "anything")).toBe(true)
    expect(matches("*", "")).toBe(true)
  })

  test("matching is case-insensitive", () => {
    expect(matches("Anthropic/*", "anthropic/claude")).toBe(true)
    expect(matches("CLAUDE-*", "Claude-3")).toBe(true)
    expect(matches("build", "BUILD")).toBe(true)
  })

  test("regex-special characters in a pattern are literal", () => {
    expect(matches("gpt-4.1", "gpt-4.1")).toBe(true)
    expect(matches("gpt-4.1", "gpt-4x1")).toBe(false)
    expect(matches("a+b", "a+b")).toBe(true)
    expect(matches("a+b", "aab")).toBe(false)
    expect(matches("(beta)", "(beta)")).toBe(true)
    expect(matches("(beta)", "beta")).toBe(false)
    expect(matches("a|b", "a|b")).toBe(true)
    expect(matches("a|b", "a")).toBe(false)
    expect(matches("^start$", "^start$")).toBe(true)
    expect(matches("^start$", "start")).toBe(false)
    expect(matches("[x]", "[x]")).toBe(true)
    expect(matches("[x]", "x")).toBe(false)
  })

  test("`*` interacts with literal dots correctly", () => {
    expect(matches("*.example.com", "api.example.com")).toBe(true)
    expect(matches("*.example.com", "apiXexample.com")).toBe(false)
  })
})

describe("matchesAny", () => {
  test("empty input returns false", () => {
    expect(matchesAny([], "build")).toBe(false)
    expect(matchesAny(undefined, "build")).toBe(false)
  })

  test("true when any pattern matches", () => {
    expect(matchesAny(["plan", "build"], "build")).toBe(true)
    expect(matchesAny(["plan", "build"], "review")).toBe(false)
  })
})
