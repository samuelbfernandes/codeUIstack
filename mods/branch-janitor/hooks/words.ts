// Plain-word commands: a prompt that is EXACTLY one of these (ignoring case, surrounding blanks, repeated
// blanks and one trailing full stop) is the same as the slash command, answered locally and never sent to
// the model. A prompt that merely contains one of the words is not a command.
const LISTING = ['branch-janitor', 'janitor', 'clean branches', 'clean up branches', 'cleanup branches', 'delete merged branches']
const BY_TEXT = new Map<string, string>([
  ...LISTING.map(w => [w, ''] as const),
  ['branch-janitor clean', 'clean'],
  ['janitor clean', 'clean'],
  ['branch-janitor on', 'on'],
  ['branch-janitor off', 'off'],
])

/** The slash command's argument (`''` list, `clean`, `on`, `off`) for a plain-word prompt, else undefined. */
export function plainWord(text: string): string | undefined {
  const normal = text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '').trim()
  return BY_TEXT.get(normal)
}
