// Runs tests/real-git.integration.ts under plain Node (22.15+): teaches the loader that the extensionless
// imports in hooks/*.ts mean .ts files, then loads the script. With bun: `bun tests/real-git.integration.ts`.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const file = join(dirname(fileURLToPath(context.parentURL)), specifier + '.ts')
      if (existsSync(file)) return next(pathToFileURL(file).href, context)
    }
    return next(specifier, context)
  },
})
await import('./real-git.integration.ts')
