# Security policy

## Reporting a problem

Please use GitHub's private reporting: open the repository's **Security** tab, then **Report a vulnerability**. Do not open a
public issue for something that could hurt other users. You will get a first answer as soon as the maintainer can give one;
this is a small project without a service-level promise.

## What counts

- The installer changing or deleting something it should not (see `docs/SAFETY.md` for the list of what it may touch).
- A mod or git guard doing something not listed in `docs/AUDIT.md` (network use, an unexpected program, a file write).
- A way to make a release differ from the tagged source.
- A git guard that can be bypassed in a way the documentation says it cannot.

Out of scope: Claude Code, Codex or other tools themselves (report those to their vendors), and third-party projects mentioned
in `docs/SUGGESTIONS.md`.

## Supported versions

Only the latest release gets fixes.
