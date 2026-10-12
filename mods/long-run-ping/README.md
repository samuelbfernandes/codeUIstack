# long-run-ping

Tells you when a long job is done, so you can look away.

A model turn longer than `afterSec` (default 60 s), or a single Bash command longer than `commandSec` (default 120 s), gets a ping when it ends:

- a toast: `long-run-ping · done after 3m 12s`
- if `sound` is on (default): a short sound and a terminal notification

It never delays or changes anything: every hook passes the event on first, and any failure inside the mod is swallowed. At most one ping per `minGapSec` (default 30 s). Interrupted turns and subagent turns are not pinged. It uses no model calls.

## Commands

`/long-run-ping [on|off|status|test]` (no word means status)

- `on` / `off`: the switch is kept in `$.store` key `off` and mirrored in the atom `{ plugin: 'long-run-ping', key: 'isOff' }` (boolean, default false), loaded at session start, so the moddeck side bar can read it. When off, nothing happens.
- `status`: the thresholds and the last ping.
- `test`: plays the ping now.

## Settings

| setting | default | meaning |
| --- | --- | --- |
| `enabled` | true | false makes the mod do nothing |
| `afterSec` | 60 | turn length that earns a ping |
| `commandSec` | 120 | Bash command length that earns a ping |
| `minGapSec` | 30 | least time between pings |
| `sound` | true | sound and terminal notification with the toast; false is toast only |

## Ping channels (from the engine's types, `claude-code.d.ts`)

- Toast (`$.ui.toast`): always used. Verified in tests (mocked).
- Sound (`$.audio.play({ asset: 'sounds/ping.wav' })`, a 9 KB wav this mod ships): the engine documents that `afplay` plays it on macOS, and that a Linux or Windows terminal has no player and plays nothing.
- Terminal notification (`$.ui.notify`): goes through your own `preferredNotifChannel` (iTerm2, kitty, Ghostty, or the terminal bell). It does nothing without a terminal (a `-p` run, the SDK, the desktop) or if you disabled notifications.

Not verified: that the sound is actually audible and that a notification banner appears. The tests answer `$.audio.play` and `$.ui.notify` with mocks, so only the calls are checked, not what a real machine does. Try `/long-run-ping test` on your own setup.

## Tests

`claude plugin test .` and `claude plugin validate .` in this folder.
