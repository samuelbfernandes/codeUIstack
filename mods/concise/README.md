# concise

Install: `/plugin install concise --marketplace samuelbfernandes/moddeck`

Replies shaped so you can act on them: the next action first, numbered steps, where you are restated every turn, no
tangents, specific time estimates, wins made visible, no preamble or closing pleasantries.

Adapted from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) (MIT, © 2026 Ayoub Ghriss). The rules are that skill's text,
unchanged except the title, the opening, one heading and the "Persistence" section, which describes this switch. They
are in `hooks/rules.ts`; the original license is in `LICENSE`.

## What it does
- Off until you switch it on (the `concise` switch under Prompt helpers in the moddeck side bar, or `/concise on`).
  The switch is remembered across sessions.
- While on, it attaches the rules to your prompt as context. The full rules (about 1,500 tokens) go with the first
  prompt of a session, the first after switching on and the first after a compaction; every later prompt carries one
  reminder line, so the rules sit in the conversation once.
- A prompt that is only "stop concise mode" or "normal mode" switches it off; Claude confirms in one
  line and returns to its default style.
- Fail open: if anything goes wrong, the prompt goes through unchanged.

## Use
    /concise          say whether it is on or off
    /concise on       switch on
    /concise off      switch off

## Turn off
`/concise off`, the side bar switch, or `/plugin disable concise`.
