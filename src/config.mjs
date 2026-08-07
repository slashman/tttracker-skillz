import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { TrackerError } from './errors.mjs'

/**
 * Bumped whenever the on-disk day-file shape or the JSON output envelope
 * changes incompatibly. Written into every day file and every JSON payload so
 * data that outlives this code can still be read deliberately rather than
 * guessed at. See docs/SCHEMA.md.
 */
export const SCHEMA_VERSION = 2

export const STRATEGIES = ['equal', 'weighted', 'exclusive']

/**
 * Resolved from this file's own location, never from process.cwd(): the CLI has
 * to find its config no matter which directory it was invoked from.
 */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function expandHome(p) {
  if (typeof p !== 'string' || p.length === 0) return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

export function configPath() {
  return path.join(repoRoot, 'tracker.config.json')
}

function readConfigFile() {
  const file = configPath()
  if (!existsSync(file)) return {}
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    throw new TrackerError(`could not read ${file}: ${err.message}`, {
      hint: 'Check file permissions, or delete it to fall back to defaults.',
    })
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not a JSON object')
    }
    return parsed
  } catch (err) {
    throw new TrackerError(`${file} is not valid JSON: ${err.message}`, {
      hint: 'Compare it against tracker.config.example.json.',
    })
  }
}

function systemTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * dataDir precedence: TRACKER_DATA_DIR > tracker.config.json > ~/.tracker/data.
 * tz precedence: TRACKER_TZ > tracker.config.json > system timezone.
 */
export function loadConfig(env = process.env) {
  const file = readConfigFile()

  const rawDataDir = env.TRACKER_DATA_DIR || file.dataDir || path.join(os.homedir(), '.tracker', 'data')
  const dataDir = path.resolve(expandHome(rawDataDir))

  const tz = env.TRACKER_TZ || file.tz || systemTz()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    throw new TrackerError(`unknown timezone: ${tz}`, {
      hint: 'Use an IANA name such as America/Bogota, or unset TRACKER_TZ / the tz key.',
    })
  }

  const strategy = file.attributionStrategy ?? 'equal'
  if (!STRATEGIES.includes(strategy)) {
    throw new TrackerError(`unknown attributionStrategy: ${strategy}`, {
      hint: `Choose one of: ${STRATEGIES.join(', ')}.`,
    })
  }

  const lookbackDays = Number.isInteger(file.lookbackDays) && file.lookbackDays >= 0 ? file.lookbackDays : 3
  const roundStep = Number.isFinite(file.roundStep) && file.roundStep > 0 ? file.roundStep : null

  return {
    dataDir,
    tz,
    autoCommit: file.autoCommit === true,
    defaultProject: file.defaultProject ?? null,
    roundStep,
    attributionStrategy: strategy,
    lookbackDays,
    configFileExists: existsSync(configPath()),
  }
}
