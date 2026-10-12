// Fake secrets for the tests, assembled at run time so this file holds no string a secret scanner would flag.
// Every value is invented: letters and digits in a fixed pattern, nothing that was ever issued.

const ALNUM = 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ2bC4dF6hJ8kL0nP2rS4uV6xY8zA1cD3eG5iL7oR9tU1wX3'

/** `n` letters and digits, deterministic; `seed` shifts where in the alphabet it starts. */
export function body(n: number, seed = 0): string {
  let out = ''
  for (let i = 0; i < n; i++) out += ALNUM[(i + seed) % ALNUM.length]
  return out
}

export const fake = {
  github: (seed = 0) => ['ghp', '_', body(36, seed)].join(''),
  githubOauth: () => ['gho', '_', body(36, 3)].join(''),
  githubFine: () => ['github', '_pat_', body(22, 1), '_', body(40, 2)].join(''),
  gitlab: () => ['glpat', '-', body(20)].join(''),
  anthropic: () => ['sk', '-ant-', 'api03-', body(40, 5)].join(''),
  openaiProject: () => ['sk', '-proj-', body(48, 7)].join(''),
  openaiLegacy: () => ['sk', '-', body(48, 9)].join(''),
  slack: () => ['xox', 'b-', '1234567890', '-', '0987654321', '-', body(24)].join(''),
  slackWebhook: () => ['https://hooks.slack', '.com/services/', 'T0123ABCD/B0123ABCD/', body(24)].join(''),
  stripeLive: () => ['sk', '_live_', body(24)].join(''),
  stripeTest: () => ['rk', '_test_', body(24)].join(''),
  stripeHook: () => ['whsec', '_', body(32)].join(''),
  stripePublishable: () => ['pk', '_live_', body(24)].join(''),
  hf: () => ['hf', '_', body(34, 4)].join(''),
  npm: () => ['npm', '_', body(36, 6)].join(''),
  google: () => ['AIza', 'Sy', body(33, 2)].join(''),
  awsKey: () => ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  awsSecret: () => body(40, 11),
  jwt: () => ['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJ', 'zdWIiOiIxMjM0NTY3ODkwIn0', '.', body(43, 3)].join(''),
  pem: (label = 'RSA PRIVATE KEY', lines = 3) =>
    [`-----BEGIN ${label}-----`, ...Array.from({ length: lines }, (_, i) => body(64, i * 5)), `-----END ${label}-----`].join('\n'),
}
