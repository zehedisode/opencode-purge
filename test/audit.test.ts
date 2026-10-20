import { describe, expect, test } from "bun:test"
import { createAudit } from "../src/audit.js"
import type { AuditEntry } from "../src/types.js"

function makeStorage(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    data,
    async get(key: string) {
      return data.get(key)
    },
    async set(key: string, value: unknown) {
      data.set(key, value)
    },
  }
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    at: "2026-01-01T00:00:00.000Z",
    session: "session-1",
    agent: "build",
    provider: "anthropic",
    model: "claude-x",
    profile: "base",
    source: "match",
    rules: 0,
    chars: 10,
    ...overrides,
  }
}

describe("createAudit", () => {
  test("records entries and returns them in order", async () => {
    const storage = makeStorage()
    const audit = createAudit(storage, { enabled: true, max: 10 })

    await audit.record(entry({ at: "2026-01-01T00:00:01.000Z", session: "a" }))
    await audit.record(entry({ at: "2026-01-01T00:00:02.000Z", session: "b" }))

    const recent = await audit.recent()
    expect(recent.map((item) => item.session)).toEqual(["a", "b"])
    expect(storage.data.get("audit")).toHaveLength(2)
  })

  test("recent returns the newest `limit` entries", async () => {
    const storage = makeStorage()
    const audit = createAudit(storage, { max: 10 })

    for (const session of ["a", "b", "c", "d"]) await audit.record(entry({ session }))

    expect((await audit.recent(2)).map((item) => item.session)).toEqual(["c", "d"])
    expect((await audit.recent(100)).map((item) => item.session)).toEqual(["a", "b", "c", "d"])
    expect((await audit.recent(0)).map((item) => item.session)).toEqual(["d"])
  })

  test("ring buffer respects max", async () => {
    const storage = makeStorage()
    const audit = createAudit(storage, { max: 2 })

    for (const session of ["a", "b", "c"]) await audit.record(entry({ session }))

    expect((await audit.recent(10)).map((item) => item.session)).toEqual(["b", "c"])
    expect(storage.data.get("audit")).toHaveLength(2)
  })

  test("enabled:false records nothing", async () => {
    const storage = makeStorage()
    const audit = createAudit(storage, { enabled: false })

    await audit.record(entry())
    expect(storage.data.has("audit")).toBe(false)
    expect(await audit.recent()).toEqual([])
  })

  test("a missing storage records nothing and reads empty", async () => {
    const audit = createAudit(undefined, { enabled: true })
    await audit.record(entry())
    expect(await audit.recent()).toEqual([])
    await audit.clear()
  })

  test("recent on empty storage returns []", async () => {
    const storage = makeStorage()
    expect(await createAudit(storage, { max: 5 }).recent()).toEqual([])
  })

  test("corrupt stored values are ignored", async () => {
    for (const corrupt of ["garbage", 42, { entries: [] }, null, [null, "x", 7]]) {
      const storage = makeStorage({ audit: corrupt })
      expect(await createAudit(storage, { max: 5 }).recent()).toEqual([])
    }
  })

  test("partially corrupt arrays keep the valid entries", async () => {
    const storage = makeStorage({ audit: [{ at: "x" }, entry({ session: "valid" })] })
    const recent = await createAudit(storage, { max: 5 }).recent()
    expect(recent.map((item) => item.session)).toEqual(["valid"])
  })

  test("clear empties the buffer", async () => {
    const storage = makeStorage()
    const audit = createAudit(storage, { max: 5 })
    await audit.record(entry())
    await audit.clear()
    expect(await audit.recent()).toEqual([])
    expect(storage.data.get("audit")).toEqual([])
  })

  test("a throwing storage reads as empty and surfaces write failures", async () => {
    const audit = createAudit(
      {
        async get() {
          throw new Error("boom")
        },
        async set() {
          throw new Error("boom")
        },
      },
      { max: 5 },
    )

    expect(await audit.recent()).toEqual([])
    await expect(audit.record(entry())).rejects.toThrow("boom")
  })

  test("clamps a nonsense max instead of throwing", async () => {
    for (const max of [0, -5, Number.NaN, 100_000]) {
      const storage = makeStorage()
      const audit = createAudit(storage, { max })
      await audit.record(entry({ session: "a" }))
      await audit.record(entry({ session: "b" }))
      const recent = await audit.recent(10)
      expect(recent.length).toBeGreaterThan(0)
      expect(recent.at(-1)?.session).toBe("b")
    }
  })
})
