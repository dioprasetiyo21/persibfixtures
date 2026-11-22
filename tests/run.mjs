import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(path.join(tmpdir(), 'persib-highlights-tests-'))
const aliasDir = path.join(out, 'node_modules', '@')

function cleanup() {
  try {
    unlinkSync(aliasDir)
  } catch {
    // Junction may already be gone.
  }
  rmSync(out, { recursive: true, force: true })
}

try {
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      path.join(root, 'tsconfig.tests.json'),
      '--outDir',
      out,
      '--pretty',
      'false',
    ],
    { cwd: root, stdio: 'inherit' },
  )

  cpSync(path.join(root, 'data'), path.join(out, 'data'), { recursive: true })

  const { mkdirSync } = await import('node:fs')
  mkdirSync(path.join(out, 'node_modules'), { recursive: true })
  symlinkSync(out, aliasDir, process.platform === 'win32' ? 'junction' : 'dir')

  execFileSync(process.execPath, ['--test', path.join(out, 'tests')], {
    cwd: out,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_PATH: path.join(root, 'node_modules'),
      SYNC_SIGNING_SECRET: 'test-only-signing-secret',
      NODE_ENV: 'test',
    },
  })
} finally {
  cleanup()
}
