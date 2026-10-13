# UI development in R, Python and JavaScript

Tools that make building interfaces faster: plumber APIs with a JavaScript front end, Shiny (R and Python), Streamlit,
Gradio, Panel, Quarto and plain HTML. Three kinds:

1. **Moddeck's own mods** (installed with the rest): `ui-preview`, `format-on-edit`, `color-lab`, `csv-table`.
2. **Optional installer items** (the "UI development" list; never switched on by default, never picked by `--standard`
   or `--all`): tick them in the installer, or `--with <id>`. `uninstall` removes exactly what was added.
3. **Programs and per-project skills** the installer does not touch: install them yourself with the commands below.

Commands were copied from each project's own page on 2026-10-13. Check the page again before you run one.

## 1. Mods

| Mod | What it does |
|---|---|
| `ui-preview` | `/ui-preview start` runs the app in this project (a plumber API first, then a JS dev server, Shiny for R, Shiny for Python, Streamlit), lists a plumber API's routes from `/openapi.json`, takes a screenshot with headless Chrome, and puts a "review this page" prompt in the prompt box. |
| `format-on-edit` | Off until `/format-on-edit on`. Formats each file Claude edits: Air for R, Ruff for Python, Prettier or Biome for JS/CSS/HTML when the project already uses one. |
| `color-lab` | `/color-lab #1f6feb #ffffff`: hex, RGB, HSL and the WCAG contrast ratio, with the nearest passing shade when AA fails. |
| `csv-table` | `/csv-table data.csv`: the delimiter, column types and first rows of a table, in a pane. |

## 2. Installer items (`moddeck install --with <id>`)

| id | What you get | Notes |
|---|---|---|
| `mcp:chrome-devtools` | Google's Chrome DevTools MCP: Claude opens your page in Chrome and reads console errors, network traffic and performance traces. The JS half of a plumber app is where it helps most. | Added as `npx -y chrome-devtools-mcp@1.10.1 --no-usage-statistics --no-performance-crux`. Usage statistics and CrUX lookups are on by default upstream; both are off here. The version is pinned. Needs Node (`npx`). |
| `mcp:r-btw` | Posit's **btw**: R help pages, vignettes, NEWS and installed versions, read by Claude instead of guessed. Useful for plumber, shiny, bslib, gt and reactable. | Needs `install.packages("btw")`. Command from the [btw MCP page](https://posit-dev.github.io/btw/reference/mcp.html). |
| `mcp:r-mcptools` | Posit's **mcptools**: Claude runs R in a session you opened (call `mcptools::mcp_session()` in it). | Runs any R code: keep permission prompts on. Needs `install.packages("mcptools")`. |
| `mcp:plotly-cloud` | Plotly Cloud MCP: current Dash and Plotly docs, app management. | Needs a Plotly Cloud account; sign in with `/mcp`. |
| `posit:shiny` | Posit's Shiny skills: bslib dashboards, cards, value boxes, theming, brand.yml. | From [posit-dev/skills](https://github.com/posit-dev/skills). Adds that marketplace if you do not have it. |
| `posit:quarto` | Posit's Quarto skills: documents, dashboards, websites, brand.yml, alt text. | Same marketplace. |
| `posit:r-lib` | Posit's R package skills: testthat, tidyverse style, cli, lifecycle, CRAN checks. Good for APIs packaged as R packages. | Same marketplace. |
| `plugin:frontend-design` | Anthropic's frontend-design skill: distinctive typography, colour and layout. | Official plugin. |
| `plugin:pyright-lsp` | Python type errors reach Claude right after an edit (already in the main list). | Needs `pyright-langserver`. |

Not included on purpose: **Playwright MCP**. Its own README says it is not a security boundary, and one of its tools
runs arbitrary code. `ui-preview` and Chrome DevTools MCP cover screenshots and console checks.

## 3. Programs and per-project skills (install yourself)

| Tool | What it is for | Install (from its own page) |
|---|---|---|
| **Air** (Posit) | Fast R formatter; `format-on-edit` uses it. | See [posit-dev.github.io/air](https://posit-dev.github.io/air/cli.html) (Homebrew, `uv tool install air-formatter`, or the install script). |
| **Ruff** (Astral) | Python formatter and linter; `format-on-edit` uses it. | See [docs.astral.sh/ruff](https://docs.astral.sh/ruff/installation/). |
| **jarl** | R linter built on Air, with automatic fixes (alpha, community project). `format-on-edit`'s `lint` setting uses it. | See [github.com/etiennebacher/jarl](https://github.com/etiennebacher/jarl). |
| **Shiny for Python skill** | Ships inside the `shiny` package; follows the version you have. | In a project with shiny installed: `uvx library-skills --claude` ([Posit's page](https://shiny.posit.co/py/get-started/agent-skills.html)). |
| **Streamlit skills** | Built into Streamlit 1.58 and later. | `streamlit skills`. The old `streamlit/agent-skills` repository is archived; do not use it. |
| **Gradio skill** (Hugging Face) | Gradio UIs, events, layouts, Spaces. | The `hf` CLI: `hf skills add huggingface-gradio` ([huggingface/skills](https://github.com/huggingface/skills)). Its Claude marketplace ships only `hf-cli`. |
| **HoloViz skills** (Panel, hvPlot, Param) | Panel components and layouts. | `npx skills add MarcSkovMadsen/holoviz-mcp --skill panel`, or copy `skills/panel/SKILL.md` by hand ([repo](https://github.com/MarcSkovMadsen/holoviz-mcp)). A personal repository of a HoloViz core developer, small and young; its MCP server's `show` tool runs code. |
| **Playwright CLI** (Microsoft) | Scripted screenshots and clicks, if you need more than `ui-preview`. | `npm install -g @playwright/cli@latest`, then `playwright-cli install --skills` ([repo](https://github.com/microsoft/playwright-cli)). |

## Already in Claude Code, no install needed

- The desktop app's browser pane opens `http://127.0.0.1:<port>` beside the chat.
- Context7 (in the main list) fetches current package docs for R, Python and JS.
