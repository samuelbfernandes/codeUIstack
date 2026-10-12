# secret-guard

Install: `/plugin install secret-guard --marketplace samuelbfernandes/moddeck`

Keeps API keys, tokens, passwords and private keys out of what the model reads.

## What it does
- **Tool output.** After Read, Bash, Grep, WebFetch and MCP tools run, secret-looking text is replaced by a short
  placeholder such as `[secret:github-token]` before the model sees it. A second hook redacts every tool result row
  (including errors) as the model reads it. Once per turn a dim line says `Secret guard · hid 2 secrets from tool output`.
- **Typed prompts.** If a prompt you type contains a secret, it asks once: Send redacted, Send as typed, Hold it.
  Esc or any other answer holds it: `secret-guard blocked your prompt · nothing was sent`, and your text is shown again
  with the secrets hidden. Only your own typing is checked, never notifications or scheduled runs.
- Finds: AWS key pairs, GitHub, GitLab, Anthropic, OpenAI, Slack, Stripe, Hugging Face, npm and Google keys, PEM private
  keys, JWTs, `Authorization:` headers, `user:password@` in URLs, and `password` / `token` / `secret` / `api_key`
  assignments in .env, YAML, JSON, Python and R (values of 8+ characters that are not placeholders or code).
  Git SHAs, hashes, base64 data and `password <- NULL` are left alone. Counts and kinds are kept, never a secret.

## Use
    /secret-guard        what was hidden this session, by kind
    /secret-guard off    pause it (remembered);  /secret-guard on  resumes

The `/` is required: a bare `secret-guard` goes to the model like any prompt.

## Turn off
`/secret-guard off`, or the `enabled` setting, or `/plugin disable secret-guard`.

## Settings
`enabled`, `askOnPrompt` (default on; off = typed prompts are not checked), `redactEmails` (default off; IP addresses are
never hidden), `extraPatterns` (JavaScript regexes separated by `;;`, shown as `[secret:custom]`; a bad one is reported).

## Limits
- Pattern matching only: a secret with no recognizable shape (a passphrase in prose, an unquoted password containing
  `^ * ? $ ( )`) is not found. Keep .env files out of git and out of your prompts anyway.
- The model sees `[secret:...]` instead of the value, so if it rewrites a file it read, the placeholder is written.
- Not covered: `@file` mentions, pasted images, the `context` notes beside a result, tools outside the list above
  (their result row is redacted, their stored record is not), and the screen, which may show output before it is redacted.
- Held text is echoed with secrets hidden; use the up arrow in your prompt history to get the original back.
- Not verified live (the test kit only): macOS and Windows, the question dialog on the desktop app, and that the engine
  accepts the rewritten result of every tool. Nothing has been run on Windows.
