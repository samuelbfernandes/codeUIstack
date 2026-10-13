---
name: align
description: Interview the user before a bigger build (a feature, portal, pipeline, analysis), then write a spec and hand off to a fresh session. Use when a request is large or underspecified, or when asked to align, scope or plan first.
---

# Align before you build

A one-paragraph request for a big build gets filled in with guesses, and the wrong guess surfaces hours later. Spend
a few minutes on questions first.

## Steps
1. **Read what exists.** Skim the repo, `AGENTS.md`/`CLAUDE.md` and any file the request names, so no question asks
   what the code already answers.
2. **Interview in rounds.** Ask 3 to 5 numbered questions at a time, each with lettered choices and a recommended
   default (`1 b, 2 a` is a full answer). Use the question tool when there is one. Cover, in this order: the goal and who
   it is for; what "done" looks like and how it is checked; inputs, outputs and existing data; hard constraints
   (language, versions, no network, performance); what is out of scope. Skip any question a choice cannot change.
3. **Confirm.** Restate the plan in five lines or fewer. If the person says go, continue; if something is wrong, ask only
   about that.
4. **Write the spec** to `SPEC.md` (or the path the person names): goal, reader/user, done-when checks, constraints, the
   decisions made and why, open questions, and a short ordered task list. Reasons beside decisions, so later work can judge
   edge cases.
5. **Hand off.** Do not start building in this session: its context is full of the interview. End with one paste-ready
   line for a fresh session, such as `Read SPEC.md and build it; ask before changing anything the spec marks as decided.`

## Notes
- Fast is the point. When the answer is obvious from the code, state your assumption and ask the person to correct it
  instead of asking.
- Never invent a requirement to fill a section; write "open question" instead.
