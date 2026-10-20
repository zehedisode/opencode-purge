import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { createAudit } from "./audit.js"
import { createConfigStore } from "./config.js"
import { decide, hostOf } from "./guard.js"
import { formatDoctor, formatLog, formatProfiles, formatStatus } from "./report.js"
import { resolve } from "./resolve.js"
import type { AuditEntry, LoadedConfig, RequestContext, Resolution } from "./types.js"

const ID = "opencode-purge"
const MARKER = "<!-- opencode-purge:profile"
const OVERRIDES_KEY = "overrides"
const MAX_OVERRIDES = 500

function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

export default {
  id: ID,
  async setup(ctx: Plugin.Context) {
    if (ctx.options.enabled === false) return

    const store = createConfigStore({
      directory: ctx.location.directory,
      ...(typeof ctx.options.config === "string" ? { explicit: ctx.options.config } : {}),
      ...(ctx.options.global === false ? { global: false } : {}),
    })

    const overrides = new Map<string, string>()
    /** Last request context per session, so `/purge status` can answer in context. */
    const lastContext = new Map<string, RequestContext>()
    await loadOverrides()

    const audit = () => createAudit(ctx.storage as never, store.get().config.audit)

    /**
     * Resolution is pure; this wrapper only turns the loaded config into the
     * inputs it needs and never throws into the host.
     */
    const resolveFor = (
      loaded: LoadedConfig,
      sessionID: string,
      context: RequestContext,
      override?: string,
    ): Resolution => {
      const baseDir = loaded.path ? dirname(loaded.path) : ctx.location.directory
      const chosen = override ?? overrides.get(sessionID)
      return resolve({
        config: loaded.config,
        baseDir,
        context,
        read,
        ...(chosen ? { override: chosen } : {}),
      })
    }

    const contextFor = (event: { agent: string; model: { providerID: string; id: string } }): RequestContext => ({
      provider: String(event.model.providerID),
      model: event.model.id,
      agent: String(event.agent),
    })

    const rememberContext = (sessionID: string, context: RequestContext) => {
      lastContext.delete(sessionID)
      lastContext.set(sessionID, context)
      if (lastContext.size > MAX_OVERRIDES) {
        const oldest = lastContext.keys().next().value
        if (oldest !== undefined) lastContext.delete(oldest)
      }
    }

    const statusText = (sessionID: string) => {
      const loaded = store.get()
      const context = lastContext.get(sessionID) ?? { provider: "*", model: "*", agent: "*" }
      return formatStatus({
        configPath: loaded.path,
        override: overrides.get(sessionID),
        resolution: resolveFor(loaded, sessionID, context),
        context,
        config: loaded.config,
        session: sessionID,
      })
    }

    // --- injection -------------------------------------------------------

    const registrations: Array<{ dispose: () => Promise<void> }> = []

    registrations.push(
      await ctx.session.hook("context", async (event) => {
        try {
          const loaded = store.get()
          const context = contextFor(event)
          rememberContext(event.sessionID, context)
          const resolution = resolveFor(loaded, event.sessionID, context)
          if (resolution.kind !== "profile") return
          if (event.system.some((part) => part.text.includes(MARKER))) return

          event.system.push({ type: "text", text: resolution.resolved.text })

          const entry: AuditEntry = {
            at: new Date().toISOString(),
            session: event.sessionID,
            agent: String(event.agent),
            provider: String(event.model.providerID),
            model: event.model.id,
            profile: resolution.resolved.profile.id,
            source: resolution.resolved.source,
            rules: resolution.resolved.rules.length,
            chars: resolution.resolved.chars,
          }
          void audit()
            .record(entry)
            .catch(() => {})
        } catch {
          // A prompt plugin must never break a model call.
        }
      }),
    )

    // --- host policy -----------------------------------------------------

    registrations.push(
      await ctx.session.hook("http.request", (event) => {
        try {
          const guard = store.get().config.guard
          if ((guard?.mode ?? "off") === "off") return
          const host = hostOf(event.request.url)
          if (!host) return
          const decision = decide(guard, host)
          if (decision.action === "block") {
            throw new Error(`opencode-purge: outbound request to ${host} blocked (${decision.reason})`)
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith(`opencode-purge:`)) throw error
        }
      }),
    )

    // --- tools -----------------------------------------------------------

    registrations.push(
      await ctx.tool.transform((editor) => {
        editor.add({
          name: "purge_status",
          description: "Show which opencode-purge prompt profile is active for this session and why.",
          input: { type: "object", properties: {}, additionalProperties: false },
          execute: async (_input, context) => ({ content: statusText(context.sessionID) }),
        })

        editor.add({
          name: "purge_use",
          description:
            "Switch the prompt profile for the current session, or turn injection off. Use an empty call to see the configured profiles.",
          input: {
            type: "object",
            properties: {
              profile: { type: "string", description: "Profile id to activate." },
              off: { type: "boolean", description: "Set to true to disable injection for this session." },
            },
            additionalProperties: false,
          },
          execute: async (input, context) => {
            const value = (input ?? {}) as { profile?: unknown; off?: unknown }
            if (value.off === true) {
              await setOverride(context.sessionID, "off")
              return { content: `Prompt injection is off for this session.` }
            }
            if (typeof value.profile === "string" && value.profile.trim() !== "") {
              const id = value.profile.trim()
              const known = store.get().config.profiles?.some((profile) => profile.id === id)
              if (!known) {
                return {
                  content: `Unknown profile "${id}".\n\n${formatProfiles(store.get().config)}`,
                }
              }
              await setOverride(context.sessionID, id)
              return { content: `Profile "${id}" is active for this session.` }
            }
            return { content: formatProfiles(store.get().config) }
          },
        })

        editor.add({
          name: "purge_doctor",
          description: "Validate the opencode-purge configuration and list problems.",
          input: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => {
            store.invalidate()
            const loaded = store.get()
            return { content: formatDoctor(loaded.path, loaded.issues) }
          },
        })

        editor.add({
          name: "purge_log",
          description: "List recent prompt injections recorded by opencode-purge.",
          input: {
            type: "object",
            properties: { limit: { type: "number", description: "How many entries to show (default 20)." } },
            additionalProperties: false,
          },
          execute: async (input) => {
            const limit = typeof (input as { limit?: unknown })?.limit === "number" ? (input as { limit: number }).limit : 20
            return { content: formatLog(await audit().recent(limit)) }
          },
        })
      }),
    )

    // --- commands --------------------------------------------------------

    const emit = async (sessionID: string, text: string) => {
      try {
        await ctx.session.synthetic({ sessionID, text })
      } catch {
        console.warn(text)
      }
    }

    registrations.push(
      await ctx.command.transform((editor) => {
        const add = (name: string, description: string, run: (args: string, sessionID: string) => Promise<string>) => {
          editor.add({
            name,
            description,
            execute: async ({ sessionID, prompt }) => {
              const text = typeof (prompt as { text?: unknown })?.text === "string" ? (prompt as { text: string }).text : ""
              await emit(sessionID, await run(text.trim(), sessionID))
            },
          })
        }

        add("purge", "Show the active opencode-purge profile, or run /purge <status|profiles|use|off|auto|doctor|log>.", async (args, sessionID) =>
          handle(args, sessionID),
        )
        add("purge-doctor", "Validate the opencode-purge configuration.", async () => {
          store.invalidate()
          const loaded = store.get()
          return formatDoctor(loaded.path, loaded.issues)
        })
        add("purge-log", "Show recent opencode-purge injections.", async () => formatLog(await audit().recent(20)))
        add("purge-off", "Disable prompt injection for this session.", async (_args, sessionID) => {
          await setOverride(sessionID, "off")
          return "Prompt injection is off for this session."
        })
        add("purge-profiles", "List configured opencode-purge profiles.", async () => formatProfiles(store.get().config))
      }),
    )

    async function handle(args: string, sessionID: string): Promise<string> {
      const [head, ...rest] = args.split(/\s+/).filter(Boolean)
      const command = (head ?? "status").toLowerCase()

      if (command === "status") return statusText(sessionID)
      if (command === "profiles" || command === "list") return formatProfiles(store.get().config)
      if (command === "doctor") {
        store.invalidate()
        const loaded = store.get()
        return formatDoctor(loaded.path, loaded.issues)
      }
      if (command === "log") {
        const limit = Number.parseInt(rest[0] ?? "20", 10)
        return formatLog(await audit().recent(Number.isFinite(limit) ? limit : 20))
      }
      if (command === "off") {
        await setOverride(sessionID, "off")
        return "Prompt injection is off for this session."
      }
      if (command === "auto" || command === "reset") {
        await setOverride(sessionID, undefined)
        return "Back to automatic profile selection."
      }
      if (command === "use") {
        const id = rest[0]
        if (!id) return `Usage: /purge use <profile>\n\n${formatProfiles(store.get().config)}`
        const known = store.get().config.profiles?.some((profile) => profile.id === id)
        if (!known) return `Unknown profile "${id}".\n\n${formatProfiles(store.get().config)}`
        await setOverride(sessionID, id)
        return `Profile "${id}" is active for this session.`
      }

      return [
        "opencode-purge",
        "",
        "  /purge                     show status",
        "  /purge profiles            list profiles",
        "  /purge use <id>            activate a profile for this session",
        "  /purge off                 disable injection for this session",
        "  /purge auto                back to automatic selection",
        "  /purge doctor              validate the config",
        "  /purge log [n]             recent injections",
      ].join("\n")
    }

    // --- session overrides ----------------------------------------------

    async function setOverride(sessionID: string, value: string | undefined) {
      if (value === undefined) overrides.delete(sessionID)
      else overrides.set(sessionID, value)
      await saveOverrides()
    }

    async function loadOverrides() {
      try {
        const stored = await ctx.storage.get(OVERRIDES_KEY)
        if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return
        for (const [session, value] of Object.entries(stored as Record<string, unknown>)) {
          if (typeof value === "string") overrides.set(session, value)
        }
      } catch {
        // Storage is best effort.
      }
    }

    async function saveOverrides() {
      try {
        if (overrides.size > MAX_OVERRIDES) {
          const keep = Array.from(overrides.entries()).slice(-MAX_OVERRIDES)
          overrides.clear()
          for (const [session, value] of keep) overrides.set(session, value)
        }
        await ctx.storage.set(OVERRIDES_KEY, Object.fromEntries(overrides) as never)
      } catch {
        // Storage is best effort.
      }
    }

    const loaded = store.get()
    if (loaded.issues.length > 0) {
      const errors = loaded.issues.filter((issue) => issue.level === "error")
      if (errors.length > 0) {
        console.warn(`${ID}: ${errors.length} config error(s) in ${loaded.path ?? "config"}; run /purge doctor`)
      }
    }

    return async () => {
      for (const registration of registrations) await registration.dispose()
    }
  },
} satisfies Plugin.Plugin
