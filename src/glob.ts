/**
 * Tiny glob matcher. Supports `*` only, which is all the config surface needs:
 * `anthropic/*`, `claude-*`, `*sonnet*`, `build`.
 */

const cache = new Map<string, RegExp>()

export function matches(pattern: string, value: string): boolean {
  if (!pattern || pattern === "*") return true
  let regex = cache.get(pattern)
  if (!regex) {
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")
    regex = new RegExp(`^${source}$`, "i")
    cache.set(pattern, regex)
  }
  return regex.test(value)
}

export function matchesAny(patterns: readonly string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) return false
  return patterns.some((pattern) => matches(pattern, value))
}
