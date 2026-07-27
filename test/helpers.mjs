import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CLI = path.join(REPO, 'bin', 'tracker.mjs')
export const TZ = 'America/Bogota'

export function tempDataDir(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tracker-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/**
 * Runs the real CLI in a child process. Integration rather than unit: the envelope,
 * exit codes and stdout/stderr discipline are part of the contract the skill relies
 * on, and only a real invocation exercises them.
 */
export function run(dataDir, args, { now = '2026-07-27T17:00:00-05:00', expectFail = false } = {}) {
  const env = { ...process.env, TRACKER_DATA_DIR: dataDir, TRACKER_TZ: TZ, TRACKER_NOW: now }
  delete env.TRACKER_SKILL_ROOTS
  let stdout = ''
  let status = 0
  try {
    stdout = execFileSync(process.execPath, [CLI, ...args, '--json'], { env, stdio: 'pipe' }).toString()
  } catch (err) {
    stdout = err.stdout?.toString() ?? ''
    status = err.status ?? 1
  }
  const parsed = JSON.parse(stdout.trim())
  if (!expectFail && parsed.ok !== true) throw new Error(`expected success, got: ${stdout}`)
  if (expectFail && parsed.ok !== false) throw new Error(`expected failure, got: ${stdout}`)
  return { ...parsed, status }
}

/**
 * Raw invocation, for asserting on stdout/stderr separation and non-JSON output.
 * spawnSync rather than execFileSync: the latter only returns stdout on success, so
 * stderr assertions would silently pass against an empty string.
 */
export function runRaw(dataDir, args, { now = '2026-07-27T17:00:00-05:00' } = {}) {
  const env = { ...process.env, TRACKER_DATA_DIR: dataDir, TRACKER_TZ: TZ, TRACKER_NOW: now }
  const result = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 }
}
