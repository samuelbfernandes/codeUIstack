// scope-watch: pure path arithmetic (no engine access), for POSIX and Windows paths alike.

/** True for `/x`, `\\server\x`, `C:\x` and `C:/x`. */
export const isAbsolute = (path: string): boolean => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)

/** True when the path is spelled the Windows way (a drive letter or a UNC share), where case does not matter. */
export const isWindowsPath = (path: string): boolean => /^(?:[A-Za-z]:|[\\/]{2}[^\\/])/.test(path)

/** Forward slashes, `.` and `..` folded, no trailing slash, drive letter upper-cased. A relative path stays relative. */
export function normalize(path: string): string {
  const s = path.trim().replace(/\\/g, '/')
  let root = ''
  let rest = s
  const drive = /^([A-Za-z]):(\/|$)/.exec(s)
  if (drive) {
    root = `${drive[1]!.toUpperCase()}:/`
    rest = s.slice(drive[0].length)
  } else if (s.startsWith('//')) {
    root = '//'
    rest = s.slice(2)
  } else if (s.startsWith('/')) {
    root = '/'
    rest = s.slice(1)
  }
  const parts: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (root === '') parts.push('..')
      continue
    }
    parts.push(seg)
  }

  return root + parts.join('/') || '.'
}

/** `path` made absolute against `cwd` (when relative) and normalised. */
export function absolute(cwd: string, path: string): string {
  return normalize(isAbsolute(path) ? path : `${cwd}/${path}`)
}

const same = (a: string, b: string, isFolded: boolean) => (isFolded ? a.toLowerCase() === b.toLowerCase() : a === b)

/** True when `file` is `folder` or lies beneath it (both absolute and normalised). */
export function isInside(file: string, folder: string): boolean {
  const isFolded = isWindowsPath(folder)
  if (same(file, folder, isFolded)) return true
  const prefix = folder.endsWith('/') ? folder : `${folder}/`

  return same(file.slice(0, prefix.length), prefix, isFolded)
}

/** `path` (absolute, normalised) relative to `cwd` when it lies beneath it; else as it is. */
export function relativeTo(cwd: string, path: string): string {
  const base = normalize(cwd)
  if (same(path, base, isWindowsPath(base))) return '.'

  return isInside(path, base) ? path.slice((base.endsWith('/') ? base : `${base}/`).length) : path
}

/** The path as typed, without matching quotes around it. */
export function unquote(raw: string): string {
  const path = raw.trim()
  const m = /^(["'])(.*)\1$/.exec(path)

  return m ? m[2]! : path
}
