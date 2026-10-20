import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/index.js"

interface FakeTool {
  name: string
  execute: (input: unknown, context: { sessionID: string }) => Promise<{ content?: string }>
}

const directory = mkdtempSync(join(tmpdir(), "opencode-purge-plugin-"))
const previousXdg = process.env.XDG_CONFIG_HOME

/** Keeps discovery from reading a real `~/.config/opencode/purge.jsonc`. */
process.env.XDG_CONFIG_HOME = join(directory, "xdg")

function makeStorage() {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async (key: string) => data.get(key),
    set: async (key: string, value: unknown) => {
      data.set(key, value)
    },
    remove: async (key: string) => {
      data.delete(key)
    },
    scan: async () => ({ entries: [] }),
  }
}

/** Minimal editor that records what the plugin registers. */
function makeToolEditor(sink: FakeTool[]) {
  return {
    add: (definition: FakeTool) => {
      sink.push(definition)
    },
    list: () => [],
    get: () => undefined,
    remove: () => {},
    namespace: () => {},
    update: () => {},
  }
}

function makeCommandEditor(sink: string[]) {
  return {
    add: (definition: { name: string }) => {
      sink.push(definition.name)
    },
  }
}

type Hook = (input: unknown) => unknown

function makeContext(tools: FakeTool[], commands: string[]) {
  const hooks: Record<string, Hook> = {}
  let toolEditor: ((editor: ReturnType<typeof makeToolEditor>) => void) | undefined
  let commandEditor: ((editor: ReturnType<typeof makeCommandEditor>) => void) | undefined

  const context = {
    options: {},
    location: {
      directory,
      project: { id: "p", directory, canonical: directory },
    },
    storage: makeStorage(),
    session: {
      hook: async (name: string, callback: Hook) => {
        hooks[name] = callback
        return { dispose: async () => {} }
      },
      synthetic: async () => {},
    },
    tool: {
      transform: async (callback: typeof toolEditor) => {
        toolEditor = callback
        return { dispose: async () => {} }
      },
    },
    command: {
      transform: async (callback: typeof commandEditor) => {
        commandEditor = callback
        return { dispose: async () => {} }
      },
    },
  }

  return {
    context: context as unknown as Plugin.Context,
    hooks,
    applyEditors: () => {
      toolEditor!(makeToolEditor(tools))
      commandEditor!(makeCommandEditor(commands))
    },
  }
}

function makeEvent(sessionID: string) {
  return {
    sessionID,
    agent: "build",
    model: { providerID: "anthropic", id: "claude-x" },
    system: [] as Array<{ type: "text"; text: string }>,
    messages: [] as unknown[],
    tools: {},
    options: {},
  }
}

afterAll(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = previousXdg
  rmSync(directory, { recursive: true, force: true })
})

describe("plugin", () => {
  test("setup registers hooks, tools and commands, injects once and cleans up", async () => {
    mkdirSync(join(directory, "rules"), { recursive: true })
    mkdirSync(join(directory, "prompts"), { recursive: true })
    writeFileSync(
      join(directory, "prompts", "system.md"),
      "SYSTEM FROM FILE\n",
      "utf8",
    )
    writeFileSync(join(directory, "rules", "one.md"), "FIRST RULE BODY\n", "utf8")
    writeFileSync(
      join(directory, "purge.jsonc"),
      `{
        // written by the smoke test
        "version": 1,
        "default": "fallback",
        "profiles": [
          {
            "id": "matched",
            "systemFile": "prompts/system.md",
            "rules": ["rules/one.md"],
            "match": [{ "model": "claude-*" }],
          },
          { "id": "fallback", "system": "FALLBACK BODY" },
        ],
        "audit": { "enabled": true, "max": 5 },
      }`,
      "utf8",
    )

    const tools: FakeTool[] = []
    const commands: string[] = []
    const { context, hooks, applyEditors } = makeContext(tools, commands)

    const cleanup = await plugin.setup(context)

    // Hooks.
    expect(typeof hooks.context).toBe("function")
    expect(typeof hooks["http.request"]).toBe("function")

    // Tools and commands are registered through the transform editors.
    applyEditors()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "purge_doctor",
      "purge_log",
      "purge_status",
      "purge_use",
    ])
    expect(commands.sort()).toEqual(["purge", "purge-doctor", "purge-log", "purge-off", "purge-profiles"])

    // Injection.
    const event = makeEvent("session-1")
    await hooks.context!(event as never)

    expect(event.system).toHaveLength(1)
    const injected = event.system[0]!.text
    expect(injected).toContain('<!-- opencode-purge:profile id="matched" source="match" -->')
    expect(injected).toContain("SYSTEM FROM FILE")
    expect(injected).toContain("FIRST RULE BODY")

    // A second pass over the same system array must not double-inject.
    await hooks.context!(event as never)
    expect(event.system).toHaveLength(1)

    // A fresh event for the same session injects again.
    const second = makeEvent("session-2")
    await hooks.context!(second as never)
    expect(second.system).toHaveLength(1)

    // Tools run without throwing and return text content.
    for (const tool of tools) {
      const result = await tool.execute({}, { sessionID: "session-1" })
      expect(typeof result.content).toBe("string")
      expect(result.content!.length).toBeGreaterThan(0)
    }

    expect(typeof cleanup).toBe("function")
    await expect(Promise.resolve(cleanup!())).resolves.toBeUndefined()
  })
})
