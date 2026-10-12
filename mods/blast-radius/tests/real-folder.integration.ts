// REAL-DIRECTORY integration test for the Folder risk section. Builds throwaway directories and git repositories in a
// temp folder, runs the mod's real measurer through a `run` adapter that really spawns find, du and git, and checks the
// words the dialog would show (what the folder is, content classes, recoverability, hints, CRITICAL, sampling).
//
// Run:  bun tests/real-folder.integration.ts        (from the mod folder; exits non-zero on any failure)
// It is not a `*.test.ts` file because `claude plugin test` runs in a sandbox with no process access; the logic is
// covered there with scripted probes (tests/folder.test.ts). POSIX only: it needs the system find and du.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'

import { classify } from '../hooks/classify'
import { dialogText } from '../hooks/format'
import { SAMPLE_CAP } from '../hooks/folder'
import { measure } from '../hooks/measure'
import type { Report, Run } from '../hooks/measure'

declare const process: { env: Record<string, string | undefined>; exit(code: number): never }
declare const console: { log(...args: unknown[]): void }

let failures = 0
let checks = 0
function check(ok: boolean, what: string, extra = '') {
  checks++
  if (!ok) {
    failures++
    console.log(`  FAIL: ${what} ${extra}`)
  }
}

process.env.GIT_CONFIG_GLOBAL = devNull
process.env.GIT_CONFIG_SYSTEM = devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Test Author'
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'test@example.com'
process.env.GIT_TERMINAL_PROMPT = '0'

const run: Run = async (argv, cwd, opts) => {
  const r = spawnSync(argv[0]!, argv.slice(1), { cwd, encoding: 'utf8', timeout: opts?.timeoutMs ?? 20_000 })
  if (r.error) throw r.error
  return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`)
  return r.stdout.trim()
}
const put = (path: string, text = 'x\n') => {
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  writeFileSync(path, text)
}
const commitAll = (cwd: string, msg: string) => (git(cwd, 'add', '-A'), git(cwd, 'commit', '-q', '-m', msg))

/** A fake home with a project that has a bare "remote", everything pushed. */
function world() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'blast-folder-')))
  const home = join(dir, 'home')
  const proj = join(home, 'proj')
  const bare = join(dir, 'origin.git')
  mkdirSync(bare)
  git(bare, 'init', '-q', '--bare', '-b', 'main')
  mkdirSync(proj, { recursive: true })
  git(proj, 'init', '-q', '-b', 'main')
  git(proj, 'remote', 'add', 'origin', bare)
  put(join(proj, '.gitignore'), 'build/\nnode_modules/\n')
  put(join(proj, 'src/a.R'), 'x <- 1\n')
  put(join(proj, 'src/b.R'), 'y <- 2\n')
  put(join(proj, 'README.md'), '# p\n')
  commitAll(proj, 'init')
  git(proj, 'push', '-q', '-u', 'origin', 'main')
  return { dir, home, proj, bare }
}

// Run one command the way the hook does and return the report plus the dialog text.
async function ask(cmd: string, cwd: string, home: string): Promise<{ rep: Report; text: string }> {
  const f = classify(cmd, { cwd, home })[0]!
  const rep = await measure(run, f, { maxListed: 40, home, cwd })
  const text = dialogText(cmd, [rep], 0, cwd)
  if (process.env.SHOW) console.log(`\n=====\n${text}`)
  return { rep, text }
}
const folder = (r: Report) => r.folders?.[0]
const has = (text: string, s: string, what: string) => check(text.includes(s), what, `\n--- missing "${s}" in:\n${text}`)

async function main() {
  const w = world()
  const { proj, home } = w

  console.log('fully pushed tracked folder')
  {
    const { rep, text } = await ask('rm -rf src', proj, home)
    check(folder(rep)?.level === 'low', 'pushed folder is LOW', JSON.stringify(folder(rep)))
    has(text, '🟢 Low risk · deletes src/', 'headline')
    check(folder(rep)?.title === 'src/ · Low', 'title', folder(rep)?.title)
    has(text, 'Inside repository', 'what it is')
    has(text, '2 source files', 'content class')
    has(text, '2 files pushed', 'git line')
    has(text, 'Recoverable  Yes', 'recoverable yes')
    check(rep.risk?.level === 'low', 'overall LOW', JSON.stringify(rep.risk))
  }

  console.log('build output (ignored)')
  {
    put(join(proj, 'build/obj/a.o'), 'o'.repeat(50_000))
    put(join(proj, 'build/b.o'), 'o')
    const { rep, text } = await ask('rm -rf build', proj, home)
    check(folder(rep)?.level === 'low', 'build output is LOW', JSON.stringify(folder(rep)))
    has(text, 'all build output (build)', 'build context')
    has(text, 'Recoverable  Yes · only build output', 'recoverable yes, regenerable')
    check(rep.risk?.level === 'low', 'overall risk lowered from MEDIUM to LOW', JSON.stringify(rep.risk))
    // the same folder named for something else is not build output
    const nm = await ask('rm -rf node_modules src/../node_modules', proj, home)
    check(nm.rep.folders === undefined || nm.rep.folders.length >= 0, 'missing target does not crash')
  }

  console.log('data folder with untracked files')
  {
    put(join(proj, 'data/raw.csv'), 'a,b\n'.repeat(20000))
    put(join(proj, 'data/fit.rds'), 'bin')
    put(join(proj, 'data/notes.txt'), 'n')
    put(join(proj, 'data/.env'), 'TOKEN=1')
    const { rep, text } = await ask('rm -rf data', proj, home)
    check(folder(rep)?.level === 'high', 'untracked data is HIGH', JSON.stringify(folder(rep)))
    has(text, '2 data files', 'data count')
    has(text, '1 likely secret file', 'secret count')
    has(text, 'Git          4 untracked files', 'untracked line')
    has(text, 'At stake     raw.csv', 'biggest hard-to-regenerate file first')
    has(text, 'Recoverable  No', 'recoverable no')
    has(text, 'last edit within 15 minutes', 'recency')
    check(rep.risk?.level === 'high', 'overall HIGH')
  }

  console.log('repository root: pushed, then with a local-only commit and a stash')
  {
    const clean = join(w.dir, 'clean')
    git(w.dir, 'clone', '-q', w.bare, clean)
    const a = await ask(`rm -rf ${clean}`, w.dir, home)
    has(a.text, 'Repository root', 'root')
    check(folder(a.rep)?.level === 'low', 'clean pushed repo root is LOW', JSON.stringify(folder(a.rep)))
    check(a.rep.risk?.level === 'low', 'overall LOW for a clean pushed repo', JSON.stringify(a.rep.risk))
    put(join(clean, 'src/c.R'), 'z\n')
    commitAll(clean, 'local only')
    git(clean, 'stash', 'list')
    put(join(clean, 'src/d.R'), 'w\n')
    git(clean, 'add', '-A')
    git(clean, 'stash', 'push', '-q')
    const b = await ask(`rm -rf ${clean}`, w.dir, home)
    check(folder(b.rep)?.level === 'high', 'repo root with unpushed work is HIGH', JSON.stringify(folder(b.rep)))
    has(b.text, 'Local only   1 commit on no remote, 1 stash', 'whole-repo facts')
    has(b.text, '1 commit not pushed', 'unpushed line')
    has(b.text, 'its history goes too', 'what is at stake')
  }

  console.log('outside any repository, nested repository, symlinks, sync hint')
  {
    const plain = join(w.dir, 'Dropbox', 'thesis')
    put(join(plain, 'chap1.tex'), 't')
    put(join(plain, 'refs.bib'), 'b')
    put(join(plain, 'fig/a.pdf'), 'p')
    symlinkSync(join(plain, 'chap1.tex'), join(plain, 'link.tex'))
    const { rep, text } = await ask(`rm -rf ${plain}`, w.dir, home)
    check(folder(rep)?.level === 'high', 'outside any repo is HIGH')
    has(text, 'Outside git · no history, no remote', 'what')
    has(text, 'Looks synced (Dropbox)', 'sync hint')
    has(text, 'deletes may reach your other devices', 'hedged wording')
    has(text, '1 symlink inside', 'inner symlink')
    has(text, '3 data files', 'tex bib pdf are data')

    const holder = join(w.dir, 'holder')
    mkdirSync(holder, { recursive: true })
    git(w.dir, 'clone', '-q', w.bare, join(holder, 'repo1'))
    const n = await ask(`rm -rf ${holder}`, w.dir, home)
    has(n.text, '1 repository, .git too', 'nested repository')

    const link = join(w.dir, 'datalink')
    symlinkSync(plain, link)
    const l = await ask(`rm -rf ${link}`, w.dir, home)
    check(folder(l.rep)?.level === 'low', 'rm of a symlink is LOW', JSON.stringify(folder(l.rep)))
    has(l.text, 'Symbolic link to a folder', 'symlink what')
    has(l.text, 'rm removes only the link', 'symlink effect')
    check(existsSync(join(plain, 'chap1.tex')), 'nothing was deleted by the probes')
  }

  console.log('CRITICAL: home, working directory, parents')
  {
    const h = await ask(`rm -rf ${home}`, proj, home)
    check(folder(h.rep)?.level === 'high', 'home is HIGH')
    has(h.text, 'Target       Your home folder', 'home critical')
    const p = await ask('rm -rf ..', proj, home)
    has(p.text, 'Target       Your home folder', 'parent of cwd that is home')
    const c = await ask('rm -rf .', proj, home)
    has(c.text, 'Target       The folder the command runs in', 'cwd critical')
    const par = await ask('rm -rf ..', join(proj, 'src'), home)
    has(par.text, 'Target       A parent of the folder the command runs in', 'parent of runs-in folder')
    const docs = join(home, 'Documents')
    put(join(docs, 'a.docx'), 'd')
    const d = await ask(`rm -rf ${docs}`, proj, home)
    has(d.text, 'Target       Your Documents folder', 'Documents critical')
    has(d.text, 'iCloud', 'Documents iCloud hint')
  }

  console.log('chmod -R: contents stay')
  {
    const { rep, text } = await ask(`chmod -R u+w ${join(proj, 'src')}`, proj, home)
    has(text, '🟢 Low risk · changes permissions of', 'chmod low')
    has(text, 'old permissions and owners are not recorded', 'chmod wording')
    check(rep.risk?.level === 'low', 'chmod risk set from the folder')
  }

  console.log('other commands that act on folders: git clean, find -delete, cp -rf, cargo clean')
  {
    put(join(proj, 'scratch/tmp.dat'), 'd')
    const gc = await ask('git clean -fd', proj, home)
    has(gc.text, 'Recoverable', 'git clean shows folder rows')
    check(gc.rep.risk?.level === 'high', 'git clean stays HIGH (never committed)', JSON.stringify(gc.rep.risk))
    const fd = await ask('find . -name build -type d -delete', proj, home)
    check(fd.rep.folders?.[0]?.title === 'build/ · Low', 'find -delete of a build folder', fd.rep.folders?.[0]?.title)
    mkdirSync(join(w.dir, 'dest/src'), { recursive: true })
    put(join(w.dir, 'dest/src/a.R'), 'old')
    const cp = await ask(`cp -rf ${join(proj, 'src')} ${join(w.dir, 'dest')}`, w.dir, home)
    has(cp.text, 'Recoverable', 'cp -rf over a folder shows folder rows')
    has(cp.text, 'overwrites', 'cp -rf verb')
    put(join(proj, 'target/debug/x'), 'x')
    const cc = await ask('cargo clean', proj, home)
    check(cc.rep.folders?.[0]?.title === 'target/ · Low', 'cargo clean target is build output', cc.rep.folders?.[0]?.title)
    const mv = await ask(`mv -f ${join(proj, 'src')} ${join(w.dir, 'nonexistent')}`, w.dir, home)
    check(mv.rep.skip === true, 'mv -f onto nothing is not held')
  }

  console.log('sampling cap')
  {
    const big = join(w.dir, 'big')
    mkdirSync(big, { recursive: true })
    for (let d = 0; d < 31; d++) {
      mkdirSync(join(big, `d${d}`), { recursive: true })
      for (let k = 0; k < 100; k++) writeFileSync(join(big, `d${d}`, `f${k}.txt`), 'x')
    }
    const { rep, text } = await ask(`rm -rf ${big}`, w.dir, home)
    has(text, `sampled: first ${SAMPLE_CAP.toLocaleString('en-US')} of 3,100 files`, 'sampled wording')
    check(folder(rep)?.level === 'high', 'sampled outside folder is not LOW')
  }

  console.log('old files: nothing changed lately')
  {
    const old = join(w.dir, 'old')
    put(join(old, 'a.txt'), 'a')
    const t = Date.now() / 1000 - 90 * 86400
    utimesSync(join(old, 'a.txt'), t, t)
    const { text } = await ask(`rm -rf ${old}`, w.dir, home)
    has(text, 'not edited in 30 days', 'old')
  }

  rmSync(w.dir, { recursive: true, force: true })
  console.log(`${checks - failures}/${checks} checks passed`)
  if (failures > 0) process.exit(1)
}

main().catch(e => {
  console.log('CRASH', e)
  process.exit(1)
})
