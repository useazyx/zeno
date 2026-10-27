/**
 * Ranking for the command palette.
 *
 * Accent- and case-insensitive, because nobody types "ocorrências" with the
 * tilde under pressure. A command matches when every typed word is the start of
 * one of its words, or appears inside its label; prefix matches rank first.
 */

export interface Command {
  id: string
  label: string
  /** Extra words that should find the command ("hidrante" finds "Pontos de água"). */
  keywords?: string[]
  group: string
}

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

function score(command: Command, terms: string[]): number {
  const haystack = normalize([command.label, ...(command.keywords ?? [])].join(" "))
  const words = haystack.split(/[^a-z0-9]+/).filter(Boolean)
  let total = 0

  for (const term of terms) {
    if (words.some((word) => word === term)) total += 3
    else if (words.some((word) => word.startsWith(term))) total += 2
    else if (haystack.includes(term)) total += 1
    else return 0
  }

  // A label that starts with what was typed is almost always the one meant.
  if (normalize(command.label).startsWith(terms.join(" "))) total += 2
  return total
}

export function rankCommands<T extends Command>(commands: T[], query: string): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return commands

  return commands
    .map((command, index) => ({ command, index, value: score(command, terms) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map((entry) => entry.command)
}

/** "2026-000123", "000123" or "123": something that looks like a protocol. */
export function looksLikeProtocol(query: string): boolean {
  return /^\d{4}-\d{1,6}$|^\d{2,6}$/.test(query.trim())
}
