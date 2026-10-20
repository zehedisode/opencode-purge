import { describe, expect, test } from "bun:test"
import { parseJsonc, stripJsonc } from "../src/jsonc.js"

describe("stripJsonc", () => {
  test("removes line comments", () => {
    expect(stripJsonc('{\n  "a": 1 // one\n}')).toBe('{\n  "a": 1 \n}')
  })

  test("removes block comments", () => {
    expect(stripJsonc('/* lead */{"a":1}/* tail */')).toBe('{"a":1}')
  })

  test("keeps `//` inside a string literal", () => {
    const input = '{ "pattern": "a//b" } // not a comment'
    expect(parseJsonc(input)).toEqual({ pattern: "a//b" })
  })

  test("keeps `https://` inside a string literal", () => {
    const input = '{ "homepage": "https://example.com/x", "nested": { "url": "https://a.b//c" } }'
    expect(parseJsonc(input)).toEqual({
      homepage: "https://example.com/x",
      nested: { url: "https://a.b//c" },
    })
  })

  test("keeps escaped quotes inside strings", () => {
    expect(parseJsonc('{ "quote": "he said \\"//hi\\"" }')).toEqual({ quote: 'he said "//hi"' })
  })

  test("removes a trailing comma before `}`", () => {
    expect(stripJsonc('{"a": 1,}')).toBe('{"a": 1}')
  })

  test("removes a trailing comma before `]`", () => {
    expect(stripJsonc("[1,2,]")).toBe("[1,2]")
    expect(stripJsonc('["a", "b", ]')).toBe('["a", "b" ]')
  })

  test("does not touch comma-like text inside strings", () => {
    expect(parseJsonc('{ "list": "[1,2,]", "obj": "{,}" }')).toEqual({ list: "[1,2,]", obj: "{,}" })
  })

  test("parses a full JSONC config", () => {
    const input = `{
      // schema version
      "version": 1,
      /*
       * One profile per provider family.
       */
      "default": "base",
      "profiles": [
        {
          "id": "base",
          "system": "Be brief. // even here",
          "rules": ["rules/a.md", "rules/b.md",],
        },
      ],
    }`

    expect(parseJsonc(input)).toEqual({
      version: 1,
      default: "base",
      profiles: [{ id: "base", system: "Be brief. // even here", rules: ["rules/a.md", "rules/b.md"] }],
    })
  })

  test("rejects malformed JSON after stripping", () => {
    expect(() => parseJsonc('{ "a": }')).toThrow()
  })
})
