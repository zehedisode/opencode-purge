/**
 * Minimal JSONC reader.
 *
 * The plugin ships with zero runtime dependencies, so this strips comments and
 * trailing commas without pulling in a parser. Strings are handled properly:
 * `//` inside a string literal is not a comment.
 */

export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonc(text))
}

export function stripJsonc(text: string): string {
  const withoutComments = stripComments(text)
  return stripTrailingCommas(withoutComments)
}

function stripComments(input: string): string {
  let output = ""
  let index = 0
  let inString = false
  let quote = ""

  while (index < input.length) {
    const char = input[index]!
    const next = input[index + 1]

    if (inString) {
      output += char
      if (char === "\\") {
        output += next ?? ""
        index += 2
        continue
      }
      if (char === quote) inString = false
      index += 1
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      output += char
      index += 1
      continue
    }

    if (char === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") index += 1
      continue
    }

    if (char === "/" && next === "*") {
      index += 2
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) index += 1
      index += 2
      continue
    }

    output += char
    index += 1
  }

  return output
}

function stripTrailingCommas(input: string): string {
  let output = ""
  let index = 0
  let inString = false
  let quote = ""

  while (index < input.length) {
    const char = input[index]!

    if (inString) {
      output += char
      if (char === "\\") {
        output += input[index + 1] ?? ""
        index += 2
        continue
      }
      if (char === quote) inString = false
      index += 1
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      output += char
      index += 1
      continue
    }

    if (char === ",") {
      let lookahead = index + 1
      while (lookahead < input.length && /\s/.test(input[lookahead]!)) lookahead += 1
      const following = input[lookahead]
      if (following === "]" || following === "}") {
        index += 1
        continue
      }
    }

    output += char
    index += 1
  }

  return output
}
