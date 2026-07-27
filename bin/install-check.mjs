#!/usr/bin/env node
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import path from 'node:path'
import { SCHEMA_VERSION, configPath, loadConfig, repoRoot } from '../src/config.mjs'
import { TrackerError } from '../src/errors.mjs'
import { discoverSkills, findConflicts, skillRoots } from '../src/skills.mjs'

/**
 * First-run setup plus skill-conflict detection.
 *
 * This reports; it does not repair. Every finding carries the exact command or edit
 * that fixes it, and the install-skill skill walks the developer through choosing.
 * In particular a conflict is never resolved by editing this repo's own skill
 * descriptions - that would bury a machine-specific workaround in a shared artifact.
 */

const OPTIONS = {
  json: { type: 'boolean' },
  'no-tests': { type: 'boolean' },
  'no-conflicts': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
}

const USAGE = `install-check — verify this checkout is ready, and find skills that compete with it

  node ./bin/install-check.mjs [--json] [--no-tests] [--no-conflicts]
`

function check(id, status, detail, fix = null) {
  return { id, status, detail, fix }
}

function nodeVersionCheck() {
  const major = Number(process.versions.node.split('.')[0])
  return major >= 20
    ? check('node-version', 'ok', `node ${process.versions.node}`)
    : check('node-version', 'fail', `node ${process.versions.node} is too old`, 'Install Node 20 or newer.')
}

function configCheck() {
  const file = configPath()
  if (!existsSync(file)) {
    return check(
      'config-file',
      'warn',
      `${file} does not exist; defaults are in use`,
      'cp tracker.config.example.json tracker.config.json, then set "dataDir".',
    )
  }
  return check('config-file', 'ok', `${file} present`)
}

function dataDirChecks(cfg) {
  const out = []
  if (!existsSync(cfg.dataDir)) {
    out.push(
      check(
        'data-dir',
        'warn',
        `${cfg.dataDir} does not exist yet (it is created on first write)`,
        `mkdir -p ${cfg.dataDir}`,
      ),
    )
  } else {
    try {
      accessSync(cfg.dataDir, constants.W_OK)
      out.push(check('data-dir', 'ok', `${cfg.dataDir} is writable`))
    } catch {
      out.push(check('data-dir', 'fail', `${cfg.dataDir} is not writable`, 'Fix the directory permissions.'))
    }
  }

  const isRepo = existsSync(path.join(cfg.dataDir, '.git'))
  out.push(
    isRepo
      ? check('data-dir-git', 'ok', 'the data dir is a git repository, so tracked time has its own history')
      : check(
          'data-dir-git',
          'warn',
          'the data dir is not a git repository',
          `git init ${cfg.dataDir} — optional, but it gives your time data a history and makes autoCommit useful.`,
        ),
  )

  if (cfg.autoCommit && !isRepo) {
    out.push(
      check(
        'auto-commit',
        'warn',
        'autoCommit is enabled but the data dir is not a git repo, so commits are skipped',
        `git init ${cfg.dataDir}, or set autoCommit to false.`,
      ),
    )
  }
  return out
}

function allowlistCheck() {
  const file = path.join(repoRoot, '.claude', 'settings.json')
  if (!existsSync(file)) {
    return check('allowlist', 'warn', `${file} is missing, so every tracker call will prompt`, 'Restore it from git.')
  }
  let allow = []
  try {
    allow = JSON.parse(readFileSync(file, 'utf8'))?.permissions?.allow ?? []
  } catch (err) {
    return check('allowlist', 'fail', `${file} is not valid JSON: ${err.message}`, 'Fix the JSON syntax.')
  }
  const covers = (needle) => allow.some((rule) => rule.includes(needle))
  const missing = ['bin/tracker.mjs', 'bin/install-check.mjs'].filter((n) => !covers(n))
  return missing.length === 0
    ? check('allowlist', 'ok', `${allow.length} permission rules cover the tracker CLI`)
    : check('allowlist', 'warn', `no allowlist rule for: ${missing.join(', ')}`, `Add Bash(node ./${missing[0]}:*) to ${file}.`)
}

function testsCheck() {
  try {
    execFileSync(process.execPath, ['--test'], { cwd: repoRoot, stdio: 'pipe', timeout: 120_000 })
    return check('tests', 'ok', 'node --test passes')
  } catch (err) {
    const output = `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`
    const failLine = output.split('\n').find((l) => /^# fail \d+/.test(l.trim())) ?? ''
    return check('tests', 'fail', `node --test failed ${failLine.trim()}`.trim(), 'Run `node --test` for the details.')
  }
}

function conflictReport() {
  const roots = skillRoots()
  const all = discoverSkills(roots)
  const projectRoot = path.join(repoRoot, '.claude', 'skills')
  const mine = all.filter((s) => s.file.startsWith(projectRoot) || s.scope === 'project')
  const others = all.filter((s) => !mine.includes(s))
  return {
    roots: roots.map((r) => ({ ...r, exists: existsSync(r.dir) })),
    repoSkills: mine.map((s) => ({ name: s.name, file: s.file, hasDescription: s.description.length > 0 })),
    scanned: others.length,
    conflicts: findConflicts(mine, others),
  }
}

function main(argv) {
  const useJson = argv.includes('--json')
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      process.stdout.write(USAGE)
      return
    }

    let parsed
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true })
    } catch (err) {
      throw new TrackerError(err.message.split('\n')[0], { hint: 'See --help.' })
    }

    const checks = [nodeVersionCheck(), configCheck()]
    let cfg = null
    try {
      cfg = loadConfig()
      checks.push(...dataDirChecks(cfg))
    } catch (err) {
      checks.push(check('config-load', 'fail', err.message, err.hint ?? 'Fix tracker.config.json.'))
    }
    checks.push(allowlistCheck())
    if (parsed.values['no-tests'] !== true) checks.push(testsCheck())
    else checks.push(check('tests', 'skipped', 'skipped with --no-tests', 'Run `node --test` yourself.'))

    const skills = parsed.values['no-conflicts'] === true ? null : conflictReport()

    const failed = checks.filter((c) => c.status === 'fail')
    const warned = checks.filter((c) => c.status === 'warn')
    const hard = skills?.conflicts.filter((c) => c.kind === 'hard') ?? []
    const soft = skills?.conflicts.filter((c) => c.kind === 'soft') ?? []

    const summary =
      `${checks.length - failed.length - warned.length} ok, ${warned.length} warn, ${failed.length} fail` +
      (skills ? `; ${hard.length} hard and ${soft.length} soft skill conflicts across ${skills.scanned} installed skills` : '')

    const data = { checks, summary, skills, dataDir: cfg?.dataDir ?? null, tz: cfg?.tz ?? null }

    if (useJson) {
      process.stdout.write(
        `${JSON.stringify({
          ok: failed.length === 0,
          schemaVersion: SCHEMA_VERSION,
          command: 'install-check',
          data,
          message: summary,
          warnings: warned.map((w) => `${w.id}: ${w.detail}`),
        })}\n`,
      )
      if (failed.length > 0) process.exitCode = 1
      return
    }

    const icon = { ok: '✓', warn: '!', fail: '✗', skipped: '-' }
    for (const c of checks) {
      process.stdout.write(`${icon[c.status]} ${c.id}: ${c.detail}\n`)
      if (c.fix && c.status !== 'ok') process.stdout.write(`    fix: ${c.fix}\n`)
    }
    if (skills) {
      process.stdout.write(`\nskills scanned: ${skills.scanned} (roots: ${skills.roots.map((r) => r.dir).join(', ')})\n`)
      if (skills.conflicts.length === 0) process.stdout.write('no competing skills found\n')
      for (const c of skills.conflicts) {
        process.stdout.write(
          `\n[${c.kind}] ${c.repoSkill} vs ${c.other.name} (${c.other.scope}${c.other.source ? `, ${c.other.source}` : ''})\n` +
            `    ${c.other.file}\n    ${c.reason}\n`,
        )
        for (const p of c.sharedPhrases.slice(0, 8)) process.stdout.write(`    shared: "${p}"\n`)
        if (c.resolution) process.stdout.write(`    ${c.resolution}\n`)
      }
    }
    process.stdout.write(`\n${summary}\n`)
    if (failed.length > 0) process.exitCode = 1
  } catch (err) {
    const isTracker = err instanceof TrackerError
    if (useJson) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          schemaVersion: SCHEMA_VERSION,
          command: 'install-check',
          error: isTracker ? err.message : `internal error: ${err.message}`,
          hint: isTracker ? (err.hint ?? null) : 'This is a bug in tracker.',
        })}\n`,
      )
    } else {
      process.stderr.write(`error: ${err.message}\n`)
    }
    process.exitCode = 1
  }
}

main(process.argv.slice(2))
