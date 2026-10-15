# ssh-connect

One-click SSH from the moddeck side bar. `/ssh` opens a terminal window on a host from your `~/.ssh/config`, so you type any
password or 2FA code yourself: the mod never sees, stores or sends it.

Install: `/plugin install ssh-connect --marketplace samuelbfernandes/moddeck`

## Commands
| | |
|---|---|
| `/ssh connect [host]` | macOS/Linux: terminal window running `ssh -fN host` (a background connection). Windows: an interactive session. |
| `/ssh shell [host]` | terminal window with an interactive `ssh host` |
| `/ssh status [host]` | `ssh -O check`: connected or not (macOS/Linux) |
| `/ssh disconnect [host]` | `ssh -O exit` (macOS/Linux) |
| `/ssh hosts` | the `Host` names found in your config |

`host` is optional: a name you type, else the **default host** setting (`/config`), else the only host in your config, else a list.
The side bar shows `ssh` with `[shell]`, `[status]` and `[off]`.

## Keep the connection open (so other tools reuse it)
Add this to the `Host` block in `~/.ssh/config` (macOS/Linux):
```
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 4h
```
After one login (and one 2FA code) every `ssh host` and every tool that uses it, a skill or script included, shares that
connection until it times out.

## Platforms
- **macOS**: Terminal.app, opened with `osascript`. **Linux**: the first of `x-terminal-emulator`, `gnome-terminal`, `konsole`,
  `xfce4-terminal`, `xterm` on your PATH. **Windows 10+**: a new console window running the built-in OpenSSH client (turn it on
  under Optional Features).
- No terminal found or it would not open: the reply gives the command and puts `! ssh …` in the prompt box.
- Windows' OpenSSH has no connection sharing, so `status` and `disconnect` say they are not available there.

## Limits
- Host names must be letters, digits, `. _ -`; anything else is refused. Nothing is run through a shell string.
- Tested here: the command logic and each platform's argv (unit tests). Opening a real window was exercised on none of the
  three platforms by the test suite.
- Turn it off: the **enabled** setting.
