import { matchesAny } from "./glob.js"
import type { GuardConfig } from "./types.js"

export type GuardDecision =
  | { action: "skip" }
  | { action: "allow"; reason: string }
  | { action: "block"; reason: string }

/**
 * Decides whether an outbound host is inside the configured scope.
 *
 * The guard never blocks loopback: a misconfigured guard must not be able to
 * cut a local provider (Ollama, llama.cpp, LM Studio) off.
 */
export function decide(guard: GuardConfig | undefined, hostname: string): GuardDecision {
  const mode = guard?.mode ?? "off"
  if (mode === "off") return { action: "skip" }
  if (isLoopback(hostname)) return { action: "allow", reason: "loopback" }

  const allow = guard?.allow ?? []
  const deny = guard?.deny ?? []

  if (matchesAny(allow, hostname)) return { action: "allow", reason: "allowlist" }

  if (mode === "allow") {
    return { action: "block", reason: "not in allowlist" }
  }

  if (matchesAny(deny, hostname)) return { action: "block", reason: "denylist" }
  return { action: "allow", reason: "not listed" }
}

export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

export function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "localhost" || host === "::1" || host === "[::1]" || host === "0.0.0.0" || host.startsWith("127.")
}
