# ui-preview

Install: `/plugin install ui-preview --marketplace samuelbfernandes/moddeck`

Runs the app in your project on `127.0.0.1` and shows it in a pane next to the chat. For a plumber API the pane
lists the routes. It also shows the app's last output lines and a screenshot, and has a button that drafts a review
prompt for Claude. Nothing starts when the mod loads: only a command or a button starts anything.

## Use
    /ui-preview                          open the pane (and say where things stand)
    /ui-preview start [file] [--port N]  start the app (detected, or the file you name)
    /ui-preview stop                     stop it
    /ui-preview shot                     take a screenshot
    /ui-preview status                   one-line status

The pane has buttons for **Start** (or **Stop**), **Screenshot**, **Ask Claude to review** and **Refresh**.

## Which app it starts
The first match wins, unless you name a file:
1. **plumber**: an R file with `#* @get`, `@post`, `@put`, `@delete`, `@patch`, `@assets` or `@plumber`, looking in the
   root folder and one level below it. `entrypoint.R`, `plumber.R` and `api.R` are preferred, in that order.
   `Rscript -e "pr <- plumber::plumb('<file>'); plumber::pr_run(pr, host = '127.0.0.1', port = <port>)"`.
   An `entrypoint.R` (one with annotations, or one that builds a router with `pr(...)`) is started with
   `plumber::plumb(dir = '<its folder>')`, which is how plumber reads an entrypoint.
2. **npm**: a `package.json` with a `scripts.dev`, in the root or in `frontend/`, `client/`, `web/`, `ui/` or `app/`.
   It runs `npm run dev -- --host 127.0.0.1 --port <port>` in that folder. This assumes a **Vite-style dev script**
   that accepts `--host` and `--port`.
3. **Shiny for R**: an `app.R` that contains `shinyApp` or `shiny::`.
   `Rscript -e "shiny::runApp('<dir>', host = '127.0.0.1', port = <port>, launch.browser = FALSE)"`.
4. **Shiny for Python**: an `app.py` with `from shiny` or `import shiny`.
   `shiny run --host 127.0.0.1 --port <port> <file>`.
5. **Streamlit**: a `.py` file with `import streamlit`.
   `streamlit run <file> --server.headless true --server.address 127.0.0.1 --server.port <port>`.

The default port is 8000 (5173 for npm). If something already answers on that port, it tries the next one (up to 20
tries). If the app prints a different `http://127.0.0.1:N` or `http://localhost:N` while it starts, that URL is used.
It checks the URL once a second until the app answers, for up to 60 s. After that the pane says `silent`, and the
app keeps running.

## The pane
- Status, the URL, and the buttons.
- **plumber**: the routes from `<url>/openapi.json` (method, path, summary), and the root URL. A plumber API that
  declares `@assets` serves its JS front end from there. The Swagger page is at `<url>/__docs__/`.
- The screenshot. The fullscreen terminal draws it with the `Image` element: pixels on kitty or Ghostty, and the
  file's path as text on other terminals. The desktop app shows the path.
- The app's last output lines. It keeps 60 and shows 15. Values that look like secrets (`token=`, `password:`,
  `api_key=`, `Bearer ...`, `sk-...`, `ghp_...`, AWS keys, JWTs) are replaced with `***`.

## Screenshot
It runs headless Chrome, Chromium or Edge. It tries, in order:
- `/Applications/Google Chrome.app/...`
- `/Applications/Chromium.app/...`
- `google-chrome`, `chromium` and `chromium-browser` on PATH
- `chrome.exe` / `msedge.exe` under Program Files (and `%LOCALAPPDATA%`)

The command is `--headless=new --disable-gpu --hide-scrollbars --window-size=1280,800
--user-data-dir=<project>/.claude/ui-preview/chrome-profile --no-first-run --no-default-browser-check
--screenshot=<png> <url>`. The separate profile means your own browser and its logins are never touched or opened.

For a plumber API whose root answers 404 (no front end), it takes the screenshot at `/__docs__/` instead. The PNG is
saved to **`<project>/.claude/ui-preview/shot.png`**. The mod creates that folder and puts a `.gitignore` containing
`*` in it, so the screenshot and the browser profile stay out of git. That folder should stay git-ignored. If no
browser is found, it says so.

## Ask Claude to review
This puts a draft in the prompt box, added after anything you have already typed, and does not send it:
`Review the running app at <url>. Screenshot: <png>. Check layout, spacing, contrast and broken requests; if the
chrome-devtools MCP is connected, open the page with it and read the console and network errors.`
If the prompt box cannot take the draft (a dialog is open), the draft is copied to the clipboard and the pane says so.
Nothing is sent to the model until you press Enter.

## Network and programs
- Network: only `http://127.0.0.1:<port>` and `http://localhost:<port>`, to check whether the app answers and to read
  `openapi.json`. This is enforced in code: any other URL is refused before the request is made.
- Programs: `Rscript`, `npm` (`npm.cmd` on Windows), `shiny`, `streamlit`, and a browser for screenshots. They are
  always started as argument lists, never through a shell.
- The app runs for the session and stops with `/ui-preview stop`, when the session ends, or when the mod is reloaded.

## State for the moddeck side bar
`{ plugin: 'ui-preview', key: 'status' }` (`'stopped' | 'starting' | 'running' | 'silent' | 'exited'`) and
`{ plugin: 'ui-preview', key: 'url' }` (string). The pane also reads `app`, `lines`, `routes`, `shot` and `note`.

## Turn off
`/ui-preview stop` stops the app. `/plugin disable ui-preview` turns off the mod.

## Limits and what was checked
- Tested with the plugin test kit (`claude plugin test`, 33 tests). The tests cover detection, the start commands,
  the localhost-only rule, the port step, picking up a printed URL, parsing the routes, scrubbing output, the
  screenshot command, the pane on the terminal and the desktop, the review draft, and starting and stopping.
- Checked live on macOS in a real headless session, with plumber 1.3.3 and Google Chrome: the app started, the
  status reached `running`, both routes were read from `openapi.json`, `shot` wrote a 1280x800 PNG, and `stop`
  ended the R process.
- Not checked live: the npm, Shiny and Streamlit start commands, the pane as actually drawn, the prompt-box fill,
  Linux, and Windows. On Windows, starting `npm.cmd` without a shell is UNVERIFIED.
- `npm run dev` starts its own child process (node/vite). Stopping kills npm; whether the dev server underneath also
  stops depends on npm and the platform (UNVERIFIED).
- R and Python do not always print their output as it happens, so the output lines can lag behind the app.
