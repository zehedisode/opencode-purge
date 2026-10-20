import type { AuditConfig, AuditEntry } from "./types.js"

const KEY = "audit"
const DEFAULT_MAX = 200

/** Structural subset of `ctx.storage` so this module stays free of OpenCode types. */
export interface AuditStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>
  recent(limit?: number): Promise<AuditEntry[]>
  clear(): Promise<void>
}

export function createAudit(storage: AuditStorage | undefined, config: AuditConfig | undefined): AuditSink {
  const enabled = config?.enabled !== false && storage !== undefined
  const max = clampMax(config?.max)

  return {
    async record(entry) {
      if (!enabled) return
      const entries = await read(storage!)
      entries.push(entry)
      const trimmed = entries.length > max ? entries.slice(entries.length - max) : entries
      await storage!.set(KEY, trimmed)
    },
    async recent(limit = 20) {
      if (storage === undefined) return []
      const entries = await read(storage)
      return entries.slice(Math.max(0, entries.length - Math.max(1, limit)))
    },
    async clear() {
      if (storage === undefined) return
      await storage.set(KEY, [])
    },
  }
}

function clampMax(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX
  return Math.min(5000, Math.max(1, Math.floor(value)))
}

async function read(storage: AuditStorage): Promise<AuditEntry[]> {
  try {
    const value = await storage.get(KEY)
    if (!Array.isArray(value)) return []
    return value.filter(isEntry)
  } catch {
    return []
  }
}

function isEntry(value: unknown): value is AuditEntry {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.at === "string" && typeof entry.session === "string"
}
