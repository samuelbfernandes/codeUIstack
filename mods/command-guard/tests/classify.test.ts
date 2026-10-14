import { test, expect } from 'claude-code/testing'

import { classify, destructiveSql, FALLBACK_RISKY, normalize } from '../hooks/classify'
import type { Kind } from '../hooks/classify'

const ctx = { cwd: '/work/proj', home: '/home/sam' }
const kinds = (cmd: string, extra = {}): Kind[] => classify(cmd, { ...ctx, ...extra }).map(f => f.kind)

// [command, kinds it must produce] -- an empty list means "must NOT be held".
const HELD: [string, Kind[]][] = [
  // rm: every flag spelling
  ['rm -rf build', ['rm']],
  ['rm -fr build', ['rm']],
  ['rm -r build', ['rm']],
  ['rm -R build', ['rm']],
  ['rm -f notes.txt', ['rm']], // -f on a single file IS held (decision documented in README)
  ['rm -r --force build', ['rm']],
  ['rm --recursive --force build', ['rm']],
  ['rm build -rf', ['rm']], // GNU rm takes options after operands
  ['rm -rfv build dist', ['rm']],
  ['rm *.csv', ['rm']], // plain rm of an unquoted glob is bulk: held
  // prefixes and quoting that must not hide the command
  ['sudo rm -rf build', ['rm']],
  ['sudo -u root rm -rf build', ['rm']],
  ['env FOO=1 rm -rf build', ['rm']],
  ['FOO=1 BAR=2 rm -rf build', ['rm']],
  ['time rm -rf build', ['rm']],
  ['nice -n 5 rm -rf build', ['rm']],
  ['timeout 30 rm -rf build', ['rm']],
  ['nohup rm -rf build', ['rm']],
  ['command rm -rf build', ['rm']],
  ['/bin/rm -rf build', ['rm']],
  ['\\rm -rf build', ['rm']],
  ['"rm" -rf build', ['rm']],
  ["'rm' '-rf' 'build'", ['rm']],
  ['r""m -rf build', ['rm']],
  // sequencing, pipes, subshells, substitutions
  ['make test; rm -rf build', ['rm']],
  ['make && rm -rf build', ['rm']],
  ['make || rm -rf build', ['rm']],
  ['echo start & rm -rf build', ['rm']],
  ['ls | xargs rm -rf', ['rm']],
  ['find . -name "*.tmp" | xargs rm', ['rm']],
  ['(rm -rf build)', ['rm']],
  ['( cd sub && rm -rf build )', ['rm']],
  ['{ rm -rf build; }', ['rm']],
  ['echo $(rm -rf build)', ['rm']],
  ['echo `rm -rf build`', ['rm']],
  ['echo "$(rm -rf build)"', ['rm']],
  ['diff <(rm -rf build) b', ['rm']],
  ['if [ -d build ]; then rm -rf build; fi', ['rm']],
  ['for d in a b; do rm -rf "$d"; done', ['rm']],
  ['while true; do rm -rf build; done', ['rm']],
  ['f() { rm -rf build; }; f', ['rm']],
  ['case $x in a) rm -rf build;; esac', ['rm']],
  ['bash -c "rm -rf build"', ['rm']],
  ["sh -lc 'cd /abs/path && rm -rf build'", ['rm']],
  ['eval "rm -rf build"', ['rm']],
  ['rm -rf $BUILD_DIR', ['rm']],
  ['rm -rf "$HOME/.cache"', ['rm']],
  ['rm -rf build/*', ['rm']],
  ['cd /abs/path && rm -rf build', ['rm']],
  // find
  ['find . -name "*.o" -delete', ['find']],
  ['find /tmp -type f -mtime +7 -exec rm {} \\;', ['find']],
  ['find . -type d -empty -exec rm -rf {} +', ['find']],
  ['find . -name x -execdir rm -f {} \\;', ['find']],
  // git
  ['git clean -fd', ['git-clean']],
  ['git clean -xfd', ['git-clean']],
  ['git clean --force -d', ['git-clean']],
  ['git reset --hard', ['git-reset']],
  ['git reset --hard origin/main', ['git-reset']],
  ['git -C /repo reset --hard HEAD~3', ['git-reset']],
  ['git checkout -- .', ['git-discard']],
  ['git checkout .', ['git-discard']],
  ['git checkout main -- .', ['git-discard']],
  ['git checkout -f other', ['git-discard']],
  ['git restore .', ['git-discard']],
  ['git restore --worktree --staged .', ['git-discard']],
  ['git push --force', ['git-push']],
  ['git push -f origin main', ['git-push']],
  ['git push -uf origin main', ['git-push']],
  ['git push --force-with-lease origin main', ['git-push']],
  ['git push origin +main', ['git-push']],
  ['git push origin +HEAD:release', ['git-push']],
  ['git push origin --delete old-branch', ['git-push']],
  ['git push origin :old-branch', ['git-push']],
  ['git branch -D feature', ['git-branch']],
  ['git branch -d -f feature', ['git-branch']],
  ['git stash drop', ['git-stash']],
  ['git stash drop stash@{2}', ['git-stash']],
  ['git stash clear', ['git-stash']],
  // other destroyers
  ['truncate -s 0 app.log', ['truncate']],
  ['shred -u secrets.txt', ['shred']],
  ['dd if=/dev/zero of=disk.img bs=1M count=10', ['dd']],
  ['dd if=x.iso of=/dev/disk2', ['dd']],
  ['mkfs.ext4 /dev/sdb1', ['mkfs']],
  ['mkfs -t xfs /dev/sdb1', ['mkfs']],
  ['diskutil eraseDisk JHFS+ Name disk2', ['mkfs']],
  ['chmod -R 777 .', ['chmod']],
  ['chown -R sam:staff /srv/data', ['chmod']],
  ['cargo clean', ['cargo-clean']],
  ['cargo +nightly clean -p foo', ['cargo-clean']],
  ['mv -f new.conf old.conf', ['overwrite']],
  ['cp -f a b', ['overwrite']],
  ['echo hi > notes.txt', ['redirect']], // conditional: the measurer drops it if the file is empty or new
  [': > app.log', ['redirect']],
  ['echo hi &> out.log', ['redirect']],
  ['echo $(cat a > b)', ['redirect']],
  // SQL clients
  ['psql -c "DROP TABLE users"', ['sql']],
  ['psql -d app -c "drop table if exists users cascade"', ['sql']],
  ['psql -c "TRUNCATE TABLE logs"', ['sql']],
  ['psql -c "DELETE FROM sessions"', ['sql']],
  ['sqlite3 app.db "DELETE FROM t;"', ['sql']],
  ['mysql -e "DROP DATABASE shop"', ['sql']],
  ['echo "DROP TABLE x;" | psql app', ['sql']],
  ["psql app <<'SQL'\nDELETE FROM users;\nSQL", ['sql']],
  ['psql app <<< "TRUNCATE users"', ['sql']],
  // R
  ['Rscript -e \'unlink("out", recursive = TRUE)\'', ['r']],
  ['R -e \'unlink(c("a","b"), recursive=T)\'', ['r']],
  ['Rscript -e \'file.remove("results.rds")\'', ['r']],
  ['Rscript -e \'fs::dir_delete("cache")\'', ['r']],
  ['Rscript -e \'system("rm -rf cache")\'', ['rm']],
  // a variable as command name with rm-like flags is held as opaque
  ['$RM -rf build', ['opaque']],
]

const BENIGN: string[] = [
  'ls -la',
  'rm notes.txt', // plain rm of one named file: not held (the permission prompt covers it)
  'rm a.txt b.txt',
  'rm -i notes.txt',
  'rm "*.csv"', // quoted: no glob
  'echo "rm -rf build"',
  "grep 'git reset --hard' README.md",
  'git commit -m "rm -rf the build dir"',
  'git status',
  'git push',
  'git push origin main',
  'git push -u origin main',
  'git pull --rebase',
  'git clean -n',
  'git clean -nfd',
  'git reset --soft HEAD~1',
  'git reset HEAD file.R',
  'git checkout main',
  'git checkout -b topic',
  'git restore --staged .',
  'git restore file.R',
  'git branch -d merged-topic',
  'git branch -a',
  'git stash',
  'git stash pop',
  'find . -name "*.R" -print',
  'find . -exec grep -l TODO {} \\;',
  'echo hi >> log.txt',
  'echo hi > /dev/null',
  'make 2>&1 | tee build.log',
  'ls 2>&1',
  'chmod 644 file',
  'chmod +x script.sh',
  'chown sam file',
  'mv a b',
  'cp -n a b',
  'cp a b',
  'cargo build --release',
  'cargo test',
  'dd if=/dev/zero of=/dev/null count=1',
  'psql -c "SELECT count(*) FROM users"',
  'psql -c "DELETE FROM users WHERE id = 3"',
  'sqlite3 app.db ".tables"',
  'Rscript analysis.R',
  'Rscript -e \'print(1)\'',
  'cd /tmp && ls',
  'echo $HOME',
  'truncate_names=1 ./run.sh', // an assignment, not the truncate command
]

for (const [cmd, want] of HELD)
  test(`held: ${cmd.replace(/\n/g, '\\n')}`, () => {
    const got = kinds(cmd)
    expect(got).toEqual(want)
  })

for (const cmd of BENIGN)
  test(`not held: ${cmd}`, () => {
    expect(kinds(cmd)).toEqual([])
  })

test('cd tracking: the target is resolved against the directory it will run in', () => {
  const [f] = classify('cd /abs/path && rm -rf build', ctx)
  expect(f!.cwd).toBe('/abs/path')
  expect(f!.targets[0]!.path).toBe('/abs/path/build')
  expect(classify('cd sub && cd .. && rm -rf x', ctx)[0]!.targets[0]!.path).toBe('/work/proj/x')
  expect(classify('cd ~/data && rm -rf x', ctx)[0]!.targets[0]!.path).toBe('/home/sam/data/x')
  expect(classify('cd && rm -rf x', ctx)[0]!.targets[0]!.path).toBe('/home/sam/x')
  expect(classify('pushd /srv >/dev/null; rm -rf x', ctx)[0]!.targets[0]!.path).toBe('/srv/x')
})

test('cd tracking: a cd in a subshell or pipeline does not leak', () => {
  const fs = classify('(cd /elsewhere && rm -rf a); rm -rf b', ctx)
  expect(fs.map(f => f.targets[0]!.path)).toEqual(['/elsewhere/a', '/work/proj/b'])
  expect(classify('cd /x | cat; rm -rf y', ctx)[0]!.targets[0]!.path).toBe('/work/proj/y')
})

test('cd tracking: a cd that cannot be followed makes relative targets unresolved, still held', () => {
  for (const cmd of ['cd "$DIR" && rm -rf out', 'cd - && rm -rf out', 'cd $(mktemp -d) && rm -rf out']) {
    const hits = classify(cmd, ctx).filter(f => f.kind === 'rm')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.targets[0]!.path).toBeUndefined()
    expect(hits[0]!.targets[0]!.unresolved).toContain('cd')
  }
})

test('targets: tilde, absolute, glob, variables', () => {
  const t = (cmd: string) => classify(cmd, ctx)[0]!.targets
  expect(t('rm -rf ~/old')[0]!.path).toBe('/home/sam/old')
  expect(t('rm -rf /tmp/x/../y')[0]!.path).toBe('/tmp/y')
  expect(t('rm -rf out/*.png')[0]).toMatchObject({ glob: true, path: '/work/proj/out/*.png' })
  expect(t('rm -rf "$X/y"')[0]!.unresolved).toBeDefined()
  expect(t('rm -rf {a,b}')[0]!.unresolved).toBeDefined() // brace expansion is not evaluated
  expect(t('rm -rf ~other/x')[0]!.unresolved).toBeDefined()
})

test('critical targets are flagged', () => {
  for (const cmd of ['rm -rf /', 'rm -rf ~', 'rm -rf ~/', 'rm -rf /*', 'rm -rf .', 'rm -rf $HOME', 'rm -rf /home/sam'])
    expect(classify(cmd, ctx)[0]!.critical).toBe(true)
  expect(classify('rm -rf build', ctx)[0]!.critical).toBeUndefined()
})

test('one line can hold several findings, in order', () => {
  const got = kinds('git stash clear && rm -rf build; psql -c "DROP TABLE t"')
  expect(got).toEqual(['git-stash', 'rm', 'sql'])
})

test('extraPatterns hold commands the built-in rules do not know', () => {
  const extra = [/deploy\.sh\s+--prod/, /^terraform destroy/]
  expect(kinds('./deploy.sh --prod now', { extraPatterns: extra })).toEqual(['custom'])
  expect(kinds('terraform destroy -auto-approve', { extraPatterns: extra })).toEqual(['custom'])
  expect(kinds('./deploy.sh --staging', { extraPatterns: extra })).toEqual([])
})

test('nesting deeper than the limit is reported, not ignored', () => {
  let cmd = 'rm -rf x'
  for (let i = 0; i < 9; i++) cmd = `bash -c ${JSON.stringify(cmd)}`
  expect(kinds(cmd)).toContain('opaque')
})

test('malformed shell does not throw and still finds the command', () => {
  for (const cmd of ['rm -rf "unterminated', "rm -rf 'x", 'echo $(rm -rf x', 'rm -rf x )', 'rm -rf x <<EOF', '((', ')', '', '   ', '#'])
    expect(() => classify(cmd, ctx)).not.toThrow()
  expect(kinds('echo $(rm -rf x')).toEqual(['rm'])
  expect(kinds('rm -rf "unterminated')).toEqual(['rm'])
})

test('destructiveSql: DELETE needs a WHERE, comments do not count', () => {
  expect(destructiveSql('DELETE FROM t')).toHaveLength(1)
  expect(destructiveSql('delete from t where id = 1')).toEqual([])
  expect(destructiveSql('SELECT 1; DROP TABLE a; DELETE FROM b; DELETE FROM c WHERE x')).toHaveLength(2)
  expect(destructiveSql('-- DROP TABLE x\nSELECT 1')).toEqual([])
  expect(destructiveSql('TRUNCATE users')).toHaveLength(1)
  expect(destructiveSql('SELECT drop_count FROM stats')).toEqual([])
})

test('normalize collapses dots without touching globs', () => {
  expect(normalize('/a/./b/../c//d')).toBe('/a/c/d')
  expect(normalize('/..')).toBe('/')
  expect(normalize('/a/*/b')).toBe('/a/*/b')
})

test('the fail-closed fallback regex covers the common destroyers', () => {
  for (const cmd of ['rm -rf x', 'rm --force x', 'git reset --hard', 'git push --force', 'git push origin +main', 'git clean -fd', 'git branch -D x',
    'git stash drop', 'find . -delete', 'find . -exec rm {} ;', 'truncate -s0 f', 'shred f', 'dd if=a of=b', 'mkfs.ext4 /dev/x', 'chmod -R 700 .',
    'cargo clean', 'psql -c "DROP TABLE t"', 'echo x > file'])
    expect(FALLBACK_RISKY.test(cmd)).toBe(true)
  for (const cmd of ['ls -la', 'git status', 'echo hello', 'rm file.txt', 'make 2>&1', 'cat a >> b'])
    expect(FALLBACK_RISKY.test(cmd)).toBe(false)
})
