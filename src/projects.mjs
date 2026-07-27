import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { TrackerError } from './errors.mjs'
import { listAllDayKeys, readDay, writeDay } from './store.mjs'
import { toLocalISO } from './time.mjs'

/**
 * A free-form project name typed differently on three days must not become three
 * rows in a report - cross-project analysis is the whole point of the tool. So
 * resolution is layered, most confident first, and only the genuinely fuzzy layer
 * announces itself.
 */

export function projectsFile(cfg) {
  return path.join(cfg.dataDir, 'projects.json')
}

export function slugify(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Punctuation-insensitive key: "Client Co", "client-co" and "clientco" all collapse here. */
export function compact(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function levenshtein(a, b) {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

export function loadProjects(cfg) {
  const file = projectsFile(cfg)
  if (!existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new TrackerError(`${file} is not valid JSON: ${err.message}`, {
      hint: 'Restore it from the data dir git history, or delete it to rebuild from scratch.',
    })
  }
  if (!Array.isArray(parsed)) return []
  return parsed.map((p) => ({
    id: p.id,
    name: p.name ?? p.id,
    aliases: Array.isArray(p.aliases) ? p.aliases : [],
    createdAt: p.createdAt ?? null,
    meta: p.meta && typeof p.meta === 'object' ? p.meta : {},
  }))
}

export function saveProjects(cfg, projects) {
  mkdirSync(cfg.dataDir, { recursive: true })
  const sorted = [...projects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const file = projectsFile(cfg)
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`)
  renameSync(tmp, file)
  return sorted
}

/**
 * Resolution order:
 *   1. exact slug match on id, name or alias
 *   2. punctuation-insensitive match ("clientco" -> "client-co") - still exact, no warning
 *   3. conservative edit-distance match - reused, but ALWAYS announced in warnings,
 *      because a wrong guess here quietly merges two real projects
 *   4. create
 */
export function resolveProject(cfg, input, { create = true } = {}) {
  const projects = loadProjects(cfg)
  const warnings = []
  const raw = String(input ?? '').trim()
  if (!raw) throw new TrackerError('no project given', { hint: 'Pass --project, or set defaultProject in the config.' })

  const slug = slugify(raw)
  if (!slug) {
    throw new TrackerError(`project name has no usable characters: ${raw}`, { hint: 'Use letters or digits.' })
  }

  const keysOf = (p) => [p.id, slugify(p.name), ...p.aliases.map(slugify)]
  let hit = projects.find((p) => keysOf(p).includes(slug))

  if (!hit) {
    const target = compact(raw)
    hit = projects.find((p) => [p.id, p.name, ...p.aliases].map(compact).includes(target))
  }

  if (!hit) {
    let best = null
    for (const p of projects) {
      for (const key of keysOf(p)) {
        const dist = levenshtein(slug, key)
        const len = Math.max(slug.length, key.length)
        const allowed = len >= 8 ? 2 : len >= 4 ? 1 : 0
        if (dist <= allowed && dist / len <= 0.34 && (best === null || dist < best.dist)) {
          best = { project: p, dist }
        }
      }
    }
    if (best) {
      hit = best.project
      warnings.push(
        `matched project "${best.project.name}" from "${raw}" by similarity; ` +
          `pass --project ${best.project.id} to be explicit, or \`tracker projects alias "${raw}" <id>\` to make it exact`,
      )
    }
  }

  if (hit) return { id: hit.id, project: hit, warnings, created: false }

  if (!create) {
    throw new TrackerError(`unknown project: ${raw}`, {
      hint: `Known projects: ${projects.map((p) => p.id).join(', ') || '(none yet)'}`,
    })
  }

  const project = { id: slug, name: raw, aliases: [], createdAt: toLocalISO(new Date(), cfg.tz), meta: {} }
  saveProjects(cfg, [...projects, project])
  return { id: project.id, project, warnings, created: true }
}

export function listProjects(cfg) {
  return loadProjects(cfg)
}

export function addAlias(cfg, alias, projectId) {
  const projects = loadProjects(cfg)
  const target = projects.find((p) => p.id === projectId)
  if (!target) {
    throw new TrackerError(`unknown project id: ${projectId}`, {
      hint: `Known: ${projects.map((p) => p.id).join(', ') || '(none yet)'}`,
    })
  }
  const trimmed = String(alias).trim()
  if (!trimmed) throw new TrackerError('alias was empty')
  const clash = projects.find(
    (p) => p.id !== projectId && [p.id, slugify(p.name), ...p.aliases.map(slugify)].includes(slugify(trimmed)),
  )
  if (clash) {
    throw new TrackerError(`alias "${trimmed}" already points at ${clash.id}`, {
      hint: 'Pick a different alias, or merge the two projects.',
    })
  }
  if (!target.aliases.some((a) => slugify(a) === slugify(trimmed))) target.aliases.push(trimmed)
  saveProjects(cfg, projects)
  return target
}

export function renameProject(cfg, projectId, newName) {
  const projects = loadProjects(cfg)
  const target = projects.find((p) => p.id === projectId)
  if (!target) throw new TrackerError(`unknown project id: ${projectId}`)
  const old = target.name
  target.name = String(newName).trim()
  // Keep the old display name reachable so historical phrasing still resolves.
  if (slugify(old) !== slugify(target.name) && !target.aliases.some((a) => slugify(a) === slugify(old))) {
    target.aliases.push(old)
  }
  saveProjects(cfg, projects)
  return target
}

/**
 * Fold `fromId` into `intoId`: rewrite every affected entry across all day files,
 * inherit the aliases, and keep the old id as an alias so old phrasing still lands
 * on the surviving project.
 */
export function mergeProjects(cfg, fromId, intoId) {
  if (fromId === intoId) throw new TrackerError('cannot merge a project into itself')
  const projects = loadProjects(cfg)
  const from = projects.find((p) => p.id === fromId)
  const into = projects.find((p) => p.id === intoId)
  if (!from) throw new TrackerError(`unknown project id: ${fromId}`)
  if (!into) throw new TrackerError(`unknown project id: ${intoId}`)

  let rewritten = 0
  const touchedDays = []
  for (const key of listAllDayKeys(cfg)) {
    const day = readDay(cfg, key)
    let changed = false
    for (const entry of day.entries) {
      if (entry.project === fromId) {
        entry.project = intoId
        rewritten++
        changed = true
      }
    }
    if (changed) {
      writeDay(cfg, day)
      touchedDays.push(key)
    }
  }

  for (const alias of [from.name, from.id, ...from.aliases]) {
    if (!into.aliases.some((a) => slugify(a) === slugify(alias)) && slugify(alias) !== into.id) {
      into.aliases.push(alias)
    }
  }
  saveProjects(
    cfg,
    projects.filter((p) => p.id !== fromId),
  )

  return { from: fromId, into: intoId, entriesRewritten: rewritten, daysTouched: touchedDays }
}
