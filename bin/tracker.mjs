#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { SCHEMA_VERSION, STRATEGIES, loadConfig } from '../src/config.mjs'
import { TrackerError } from '../src/errors.mjs'
import {
  addLink,
  addNote,
  editEntry,
  logEntry,
  removeEntry,
  resumeEntry,
  splitEntry,
  startEntry,
  statusOf,
  stopEntries,
  switchTo,
} from '../src/entries.mjs'
import { addAlias, listProjects, mergeProjects, renameProject, resolveProject } from '../src/projects.mjs'
import {
  buildAnalysis,
  buildExport,
  buildReport,
  exportRowsToCsv,
  reportToCsv,
  reportToMarkdown,
} from '../src/report.mjs'
import { humanMinutes, now } from '../src/time.mjs'

const OPTIONS = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  project: { type: 'string', short: 'p' },
  at: { type: 'string' },
  tags: { type: 'string' },
  weight: { type: 'string' },
  link: { type: 'string', multiple: true },
  note: { type: 'string' },
  all: { type: 'boolean' },
  last: { type: 'boolean' },
  from: { type: 'string' },
  to: { type: 'string' },
  week: { type: 'boolean' },
  month: { type: 'boolean' },
  date: { type: 'string' },
  format: { type: 'string' },
  round: { type: 'string' },
  attribute: { type: 'boolean' },
  strategy: { type: 'string' },
  'no-balance': { type: 'boolean' },
  task: { type: 'string' },
  'first-task': { type: 'string' },
  start: { type: 'string' },
  end: { type: 'string' },
}

const USAGE = `tracker — time tracking for parallel work

  start <task words…>   --project P [--at T] [--tags a,b] [--weight N] [--link k=v] [--note N]
  stop [query]          [--all] [--at T] [--note N]
  log <task words…>     --project P --from T --to T [--tags a,b] [--weight N] [--link k=v] [--note N]
  split <id>            --at T [--task T] [--first-task T] [--note N]
  switch <task words…>  --project P
  status
  today | day [date]    [--attribute] [--strategy S] [--round N]
  report                [--from D --to D | --week | --month] [--project P] [--attribute] [--strategy S]
                        [--round N] [--no-balance] [--format md|json|csv]
  analyze               [--from D --to D | --week | --month]
  export                [--from D --to D | --week | --month] [--attribute] [--format json|csv]
  note <query|--last> <text…>
  link <query> <key=value…>
  edit <id>             [--task T] [--project P] [--start T] [--end T|null] [--tags a,b] [--weight N] [--link k=v]
  rm <id>
  resume [query]        [--at T]
  projects list | alias <alias> <id> | rename <id> <name> | merge <from> <into>

  --json on any command prints a single JSON envelope and nothing else.
  Attribution splits overlapping time so per-task totals add up to the real wall clock.
  Strategies: ${STRATEGIES.join(', ')}.
`

function num(value, flag) {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw new TrackerError(`${flag} must be a number, got: ${value}`)
  return n
}

function strategyOf(values) {
  if (values.strategy == null) return null
  if (!STRATEGIES.includes(values.strategy)) {
    throw new TrackerError(`unknown --strategy ${values.strategy}`, { hint: `Choose one of: ${STRATEGIES.join(', ')}.` })
  }
  return values.strategy
}

function rangeOpts(values, positionals) {
  return {
    from: values.from ?? null,
    to: values.to ?? null,
    week: values.week === true,
    month: values.month === true,
    date: values.date ?? positionals[0] ?? null,
    project: values.project ?? null,
    attribute: values.attribute === true,
    strategy: strategyOf(values),
    round: num(values.round, '--round'),
    balance: values['no-balance'] !== true,
  }
}

function fmt(values, fallback = 'md') {
  const f = values.format ?? fallback
  if (!['md', 'json', 'csv'].includes(f)) {
    throw new TrackerError(`unknown --format ${f}`, { hint: 'Choose md, json or csv.' })
  }
  return f
}

const COMMANDS = {
  start(cfg, values, positionals, nowDate) {
    const result = startEntry(cfg, {
      nowDate,
      task: values.task ?? positionals.join(' '),
      project: values.project,
      at: values.at,
      tags: values.tags,
      weight: num(values.weight, '--weight'),
      link: values.link,
      note: values.note,
    })
    const also =
      result.alsoOpen.length > 0
        ? ` (also running: ${result.alsoOpen.map((o) => `${o.id} ${o.task}`).join(', ')})`
        : ''
    return {
      data: result,
      message: `started ${result.entry.id} ${result.entry.project}: ${result.entry.task}${also}`,
      warnings: result.warnings,
    }
  },

  stop(cfg, values, positionals, nowDate) {
    const result = stopEntries(cfg, {
      nowDate,
      query: positionals.join(' ').trim() || null,
      all: values.all === true,
      at: values.at,
      note: values.note,
    })
    return {
      data: result,
      message: result.stopped
        .map((s) => `stopped ${s.id} ${s.project}: ${s.task} (${humanMinutes(s.durationMinutes)})`)
        .join('; '),
      warnings: result.warnings,
    }
  },

  log(cfg, values, positionals, nowDate) {
    const result = logEntry(cfg, {
      nowDate,
      task: values.task ?? positionals.join(' '),
      project: values.project,
      from: values.from,
      to: values.to,
      tags: values.tags,
      weight: num(values.weight, '--weight'),
      link: values.link,
      note: values.note,
    })
    return {
      data: result,
      message: `logged ${result.entry.id} ${result.entry.project}: ${result.entry.task} (${humanMinutes(result.durationMinutes)})`,
      warnings: result.warnings,
    }
  },

  split(cfg, values, positionals, nowDate) {
    const result = splitEntry(cfg, {
      nowDate,
      id: positionals.shift(),
      at: values.at,
      task: values.task,
      firstTask: values['first-task'],
      note: values.note,
    })
    const tail = result.second.open ? 'still running' : humanMinutes(result.second.durationMinutes)
    return {
      data: result,
      message:
        `split ${result.first.id}: ${result.first.task} (${humanMinutes(result.first.durationMinutes)}) ` +
        `→ ${result.second.id}: ${result.second.task} (${tail})`,
      warnings: result.warnings,
    }
  },

  switch(cfg, values, positionals, nowDate) {
    const result = switchTo(cfg, {
      nowDate,
      task: values.task ?? positionals.join(' '),
      project: values.project,
      at: values.at,
      tags: values.tags,
      weight: num(values.weight, '--weight'),
      link: values.link,
    })
    // Every closed entry is named: with concurrency normal, switch is destructive.
    const closed = result.closed.length
      ? `closed ${result.closed.map((c) => `${c.id} ${c.task} (${humanMinutes(c.durationMinutes)})`).join(', ')}; `
      : ''
    return {
      data: result,
      message: `${closed}started ${result.started.entry.id} ${result.started.entry.project}: ${result.started.entry.task}`,
      warnings: result.warnings,
    }
  },

  status(cfg, values, positionals, nowDate) {
    const result = statusOf(cfg, { nowDate })
    return {
      data: result,
      message:
        result.open.length === 0
          ? 'nothing running'
          : result.open
              .map(
                (o) =>
                  `${o.id} ${o.project}: ${o.task} — ${humanMinutes(o.elapsedMinutes)}${o.carriedOver ? ` (since ${o.dateKey})` : ''}`,
              )
              .join('\n'),
      warnings: [],
    }
  },

  today(cfg, values, positionals, nowDate) {
    return COMMANDS.day(cfg, values, positionals, nowDate)
  },

  day(cfg, values, positionals, nowDate) {
    const report = buildReport(cfg, { ...rangeOpts(values, positionals), nowDate })
    return {
      data: report,
      message: fmt(values) === 'csv' ? reportToCsv(report) : reportToMarkdown(report),
      warnings: report.warnings,
    }
  },

  report(cfg, values, positionals, nowDate) {
    const opts = rangeOpts(values, positionals)
    // `report` with no range flag means this week, not just today.
    if (!opts.from && !opts.to && !opts.week && !opts.month && !opts.date) opts.week = true
    const report = buildReport(cfg, { ...opts, nowDate })
    const format = fmt(values)
    return {
      data: report,
      message: format === 'csv' ? reportToCsv(report) : reportToMarkdown(report),
      warnings: report.warnings,
    }
  },

  analyze(cfg, values, positionals, nowDate) {
    const opts = rangeOpts(values, positionals)
    if (!opts.from && !opts.to && !opts.week && !opts.month && !opts.date) opts.date = null
    const analysis = buildAnalysis(cfg, { ...opts, nowDate })
    const lines = [
      `${analysis.range.label}: ${humanMinutes(analysis.rawMinutes)} raw over ${humanMinutes(analysis.unionMinutes)} of wall clock`,
      `overlap factor ${analysis.overlapFactor} (${humanMinutes(analysis.overlapMinutes)} of apparent effort was overlap)`,
      `up to ${analysis.maxConcurrency} task${analysis.maxConcurrency === 1 ? '' : 's'} at once, ${analysis.contextSwitches} context switches`,
      ...analysis.concurrencyHistogram.map(
        (h) => `  ${h.concurrency} task${h.concurrency === 1 ? '' : 's'} at once: ${humanMinutes(h.minutes)}`,
      ),
    ]
    return { data: analysis, message: lines.join('\n'), warnings: [] }
  },

  export(cfg, values, positionals, nowDate) {
    const opts = rangeOpts(values, positionals)
    if (!opts.from && !opts.to && !opts.week && !opts.month && !opts.date) opts.week = true
    const result = buildExport(cfg, { ...opts, nowDate })
    const format = fmt(values, 'csv')
    return {
      data: result,
      message: format === 'csv' ? exportRowsToCsv(result.rows) : JSON.stringify(result, null, 2),
      warnings: [],
    }
  },

  note(cfg, values, positionals, nowDate) {
    const last = values.last === true
    const query = last ? null : positionals.shift()
    const result = addNote(cfg, { nowDate, last, query, text: positionals.join(' ') })
    return { data: result, message: `noted on ${result.entry.id}: ${result.entry.task}`, warnings: result.warnings }
  },

  link(cfg, values, positionals, nowDate) {
    const query = positionals.shift()
    const pairs = [...(values.link ?? []), ...positionals]
    const result = addLink(cfg, { nowDate, query, pairs })
    return {
      data: result,
      message: `linked ${result.entry.id}: ${Object.entries(result.entry.links)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`,
      warnings: result.warnings,
    }
  },

  edit(cfg, values, positionals, nowDate) {
    const id = positionals.shift()
    if (!id) throw new TrackerError('edit needs an entry id', { hint: 'Find it with `tracker today`.' })
    const result = editEntry(cfg, {
      nowDate,
      id,
      task: values.task ?? null,
      project: values.project ?? null,
      start: values.start ?? null,
      end: values.end ?? null,
      tags: values.tags ?? null,
      weight: values.weight == null ? null : num(values.weight, '--weight'),
      link: values.link ?? null,
    })
    return { data: result, message: `edited ${result.entry.id}: ${result.entry.task}`, warnings: result.warnings }
  },

  rm(cfg, values, positionals) {
    const id = positionals.shift()
    if (!id) throw new TrackerError('rm needs an entry id')
    const result = removeEntry(cfg, { id })
    return {
      data: result,
      // Printed in full so a mistaken delete can be undone by hand.
      message: `deleted ${result.deleted.id} ${result.deleted.project}: ${result.deleted.task} (${result.deleted.start} → ${result.deleted.end ?? 'open'})`,
      warnings: result.warnings,
    }
  },

  resume(cfg, values, positionals, nowDate) {
    const result = resumeEntry(cfg, { nowDate, query: positionals.join(' ').trim() || null, at: values.at })
    return {
      data: result,
      message: `resumed ${result.entry.id} ${result.entry.project}: ${result.entry.task}`,
      warnings: result.warnings,
    }
  },

  projects(cfg, values, positionals, nowDate) {
    const sub = positionals.shift() ?? 'list'
    if (sub === 'list') {
      const projects = listProjects(cfg)
      return {
        data: { projects },
        message: projects.length
          ? projects.map((p) => `${p.id}  ${p.name}${p.aliases.length ? `  (aliases: ${p.aliases.join(', ')})` : ''}`).join('\n')
          : 'no projects yet',
        warnings: [],
      }
    }
    if (sub === 'alias') {
      const [alias, id] = [positionals.shift(), positionals.shift()]
      if (!alias || !id) throw new TrackerError('usage: projects alias <alias> <project-id>')
      const project = addAlias(cfg, alias, id)
      return { data: { project }, message: `${project.id} aliases: ${project.aliases.join(', ')}`, warnings: [] }
    }
    if (sub === 'rename') {
      const id = positionals.shift()
      const name = positionals.join(' ')
      if (!id || !name) throw new TrackerError('usage: projects rename <project-id> <new name>')
      const project = renameProject(cfg, id, name)
      return { data: { project }, message: `${project.id} is now "${project.name}"`, warnings: [] }
    }
    if (sub === 'merge') {
      const [from, into] = [positionals.shift(), positionals.shift()]
      if (!from || !into) throw new TrackerError('usage: projects merge <from-id> <into-id>')
      const result = mergeProjects(cfg, from, into)
      return {
        data: result,
        message: `merged ${result.from} into ${result.into}: ${result.entriesRewritten} entries rewritten across ${result.daysTouched.length} day files`,
        warnings: [],
      }
    }
    if (sub === 'resolve') {
      const result = resolveProject(cfg, positionals.join(' '), { create: false })
      return { data: result, message: result.id, warnings: result.warnings }
    }
    throw new TrackerError(`unknown projects subcommand: ${sub}`, { hint: 'Try list, alias, rename or merge.' })
  },
}

function emit(command, result, useJson) {
  const warnings = (result.warnings ?? []).filter(Boolean)
  if (useJson) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        command,
        data: result.data ?? null,
        message: result.message ?? '',
        warnings,
      })}\n`,
    )
    return
  }
  if (result.message) process.stdout.write(`${result.message}\n`)
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`)
}

function emitFailure(command, err, useJson) {
  const isTracker = err instanceof TrackerError
  const message = isTracker ? err.message : `internal error: ${err.message}`
  const hint = isTracker ? err.hint : 'This is a bug in tracker, not a problem with your input.'
  if (useJson) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, schemaVersion: SCHEMA_VERSION, command, error: message, hint: hint ?? null })}\n`,
    )
  } else {
    process.stderr.write(`error: ${message}\n`)
    if (hint) process.stderr.write(`hint: ${hint}\n`)
    if (!isTracker && process.env.TRACKER_DEBUG) process.stderr.write(`${err.stack}\n`)
  }
  process.exitCode = 1
}

/**
 * Options whose value is a time spec, and so may legitimately begin with '-'.
 * Mirrors the relative form accepted by parseAt in src/time.mjs.
 */
const TIME_OPTIONS = new Set(['--at', '--start', '--end'])
const RELATIVE_TIME = /^([+-])\s*(\d+(?:\.\d+)?)\s*([mh])$/i

/**
 * parseArgs refuses a value that starts with '-' ("argument is ambiguous"), which
 * breaks the documented `--at -20m` form while `--at=-20m` works. Joining the pair
 * into the '=' form before parsing keeps both spellings working. Deliberately
 * narrow: only for time-valued options, and only when the next token really is a
 * relative time, so a genuine following flag is never swallowed.
 */
function joinNegativeTimeValues(argv) {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    const next = argv[i + 1]
    if (TIME_OPTIONS.has(tok) && next !== undefined && RELATIVE_TIME.test(next)) {
      out.push(`${tok}=${next}`)
      i++
    } else {
      out.push(tok)
    }
  }
  return out
}

function main(rawArgv) {
  const argv = joinNegativeTimeValues(rawArgv)
  // --json may appear anywhere, including after a flag that failed to parse, so it
  // is sniffed before parseArgs runs. Otherwise a bad flag would print prose to a
  // caller that asked for JSON.
  const useJson = argv.includes('--json')
  let command = argv.find((a) => !a.startsWith('-')) ?? 'help'

  try {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h') || command === 'help') {
      if (useJson) {
        emit('help', { data: { usage: USAGE }, message: USAGE, warnings: [] }, true)
      } else {
        process.stdout.write(USAGE)
      }
      return
    }

    let parsed
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
    } catch (err) {
      // parseArgs throws on unknown options; convert it into the same failure
      // envelope rather than letting a stack trace reach the caller.
      throw new TrackerError(err.message.split('\n')[0], {
        hint: 'Run `tracker --help` for the accepted flags.',
      })
    }

    const positionals = [...parsed.positionals]
    command = positionals.shift() ?? 'help'
    const handler = COMMANDS[command]
    if (!handler) {
      throw new TrackerError(`unknown command: ${command}`, {
        hint: `Known commands: ${Object.keys(COMMANDS).join(', ')}.`,
      })
    }

    const cfg = loadConfig()
    const nowDate = now()
    emit(command, handler(cfg, parsed.values, positionals, nowDate), useJson)
  } catch (err) {
    emitFailure(command, err, useJson)
  }
}

main(process.argv.slice(2))
