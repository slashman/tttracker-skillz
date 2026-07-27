import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { repoRoot } from './config.mjs'

/**
 * Detecting skills that compete with this repo's skills for the same utterances.
 *
 * Division of labour, same as everywhere else in this project: this module gathers
 * and normalizes facts. Whether an overlap would ACTUALLY misfire is a judgment
 * call, and that belongs to the install-skill skill reading this output - not to a
 * similarity threshold pretending to be an answer.
 *
 * Two things this must never do, enforced by the skill that drives it: change this
 * repo's shipped skill descriptions to accommodate a local collision (that buries a
 * machine-specific fix in a shared artifact), or edit the developer's own skills
 * without showing them the diff.
 */

export function skillRoots(env = process.env) {
  if (env.TRACKER_SKILL_ROOTS) {
    return env.TRACKER_SKILL_ROOTS.split(path.delimiter)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((dir) => ({ dir, scope: 'fixture' }))
  }

  const home = os.homedir()
  const roots = [
    { dir: path.join(home, '.claude', 'skills'), scope: 'user' },
    { dir: path.join(repoRoot, '.claude', 'skills'), scope: 'project' },
  ]

  // Plugin layouts vary and may not exist at all; glob defensively rather than
  // assuming a shape.
  const pluginsDir = path.join(home, '.claude', 'plugins')
  if (existsSync(pluginsDir)) {
    for (const entry of safeReaddir(pluginsDir)) {
      const candidate = path.join(pluginsDir, entry, 'skills')
      if (isDir(candidate)) roots.push({ dir: candidate, scope: 'plugin' })
      const nested = path.join(pluginsDir, entry)
      if (isDir(nested)) {
        for (const sub of safeReaddir(nested)) {
          const deep = path.join(nested, sub, 'skills')
          if (isDir(deep)) roots.push({ dir: deep, scope: 'plugin' })
        }
      }
    }
  }

  return roots
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * YAML frontmatter, hand-rolled to keep the project dependency-free.
 *
 * Block scalars are the whole reason this is not a one-line regex: real skills
 * write `description: >` with a folded multi-line body. A naive
 * /description:\s*(.*)$/ returns an empty string for those, and then every overlap
 * check silently passes while appearing to work.
 */
export function parseFrontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}

  const lines = m[1].split(/\r?\n/)
  const out = {}
  let i = 0

  while (i < lines.length) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i])
    if (!kv) {
      i++
      continue
    }
    const key = kv[1]
    let rest = kv[2].trim()
    const block = /^([|>])([+-]?\d*)[ \t]*$/.exec(rest)

    if (block) {
      const folded = block[1] === '>'
      i++
      const body = []
      let indent = null
      while (i < lines.length) {
        const line = lines[i]
        if (line.trim() === '') {
          body.push('')
          i++
          continue
        }
        const curIndent = /^[ \t]*/.exec(line)[0].length
        if (indent === null) {
          if (curIndent === 0) break // next key, empty block
          indent = curIndent
        }
        if (curIndent < indent) break
        body.push(line.slice(indent))
        i++
      }
      out[key] = folded ? foldParagraphs(body) : body.join('\n').trim()
      continue
    }

    if ((rest.startsWith('"') && rest.endsWith('"')) || (rest.startsWith("'") && rest.endsWith("'"))) {
      rest = rest.slice(1, -1)
    }
    out[key] = rest
    i++
  }

  return out
}

/** YAML folded style: lines within a paragraph join with a space, blank lines break. */
function foldParagraphs(lines) {
  const paragraphs = []
  let current = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) paragraphs.push(current.join(' '))
      current = []
    } else {
      current.push(line.trim())
    }
  }
  if (current.length) paragraphs.push(current.join(' '))
  return paragraphs.join('\n').trim()
}

/** name -> source, from the skills manifest when one is present. */
export function loadManifestSources(roots) {
  const sources = new Map()
  for (const { dir } of roots) {
    const file = path.join(dir, 'manifest.json')
    if (!existsSync(file)) continue
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      for (const skill of parsed.skills ?? []) {
        if (skill.name) sources.set(skill.name, skill.source ?? null)
      }
    } catch {
      /* a malformed manifest is not worth failing the whole check over */
    }
  }
  return sources
}

export function discoverSkills(roots = skillRoots()) {
  const sources = loadManifestSources(roots)
  const found = []
  for (const { dir, scope } of roots) {
    if (!isDir(dir)) continue
    for (const entry of safeReaddir(dir)) {
      const file = path.join(dir, entry, 'SKILL.md')
      if (!existsSync(file)) continue
      let text = ''
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const fm = parseFrontmatter(text)
      found.push({
        name: fm.name || entry,
        dirName: entry,
        scope,
        file,
        description: fm.description || '',
        source: sources.get(fm.name || entry) ?? null,
      })
    }
  }
  return found.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name))
}

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those for of to in on at by with from into over about as is are was
   were be been being do does did doing have has had having it its i you your my me we us our they them their he she
   his her use used using when whenever also even just any some all not no can could should would will shall may might
   must skill user users asks ask asked mention mentions mentioned trigger triggers use-this what which who whom whose
   how why where else other another same via per each both any more most such only own so very s t don now
   wants want wanted wanting needs need needed asking says say said saying tells tell told requests request
   like likes something anything thing things run runs running via handles handle handled`
    .split(/\s+/)
    .filter(Boolean),
)

export function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function contentTokens(s) {
  return new Set(
    normalizeText(s)
      .split(' ')
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  )
}

/** Explicitly quoted example utterances are the strongest signal of a trigger phrase. */
export function quotedPhrases(s) {
  const out = new Set()
  for (const m of String(s).matchAll(/["“]([^"”]{3,80})["”]/g)) {
    const norm = normalizeText(m[1])
    if (norm.split(' ').length >= 2) out.add(norm)
  }
  return out
}

export function ngrams(s, { min = 2, max = 5 } = {}) {
  const words = normalizeText(s).split(' ').filter(Boolean)
  const out = new Set()
  for (let n = min; n <= max; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const slice = words.slice(i, i + n)
      // A phrase made only of stopwords ("use this skill when") is noise.
      if (slice.every((w) => STOPWORDS.has(w))) continue
      out.add(slice.join(' '))
    }
  }
  return out
}

/**
 * Shared phrases between two descriptions, reduced to the maximal ones: if both
 * mention "log my hours today", the contained 2-grams add nothing but noise.
 */
export function sharedPhrases(a, b) {
  const inBoth = new Set()
  const aAll = new Set([...ngrams(a), ...quotedPhrases(a)])
  const bAll = new Set([...ngrams(b), ...quotedPhrases(b)])
  for (const phrase of aAll) if (bAll.has(phrase)) inBoth.add(phrase)

  const list = [...inBoth].sort((x, y) => y.length - x.length)
  const maximal = []
  for (const phrase of list) {
    if (!maximal.some((kept) => kept.includes(phrase))) maximal.push(phrase)
  }
  return maximal.sort((x, y) => y.split(' ').length - x.split(' ').length || x.localeCompare(y))
}

export function jaccard(a, b) {
  const A = contentTokens(a)
  const B = contentTokens(b)
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  return Math.round((shared / (A.size + B.size - shared)) * 1000) / 1000
}

/**
 * Exact phrase matching alone is too brittle to catch the overlaps that matter:
 * "logging hours" and "this week's hours" compete for the same request but share
 * no adjacent word pair, and raw Jaccard on descriptions is too blunt to threshold
 * (a genuine competitor scored 0.126, well inside the noise of unrelated skills).
 *
 * So salience is measured against the whole installed corpus. A term shared by
 * only two skills out of twenty is evidence; a term shared by ten is vocabulary.
 */
export function buildIdf(skills) {
  const df = new Map()
  for (const skill of skills) {
    for (const token of contentTokens(skill.description)) df.set(token, (df.get(token) ?? 0) + 1)
  }
  const n = Math.max(skills.length, 1)
  const idf = new Map()
  for (const [token, count] of df) idf.set(token, Math.log((n + 1) / (count + 0.5)))
  return idf
}

/**
 * Weighted coverage: of the salience the smaller description carries, how much of
 * it is also claimed by the other skill? Normalizing by the smaller side is what
 * keeps a short focused description from being drowned out by a long one.
 */
export function salientOverlap(a, b, idf) {
  const A = contentTokens(a)
  const B = contentTokens(b)
  if (A.size === 0 || B.size === 0) return { weightedCoverage: 0, sharedTerms: [] }

  const weight = (t) => idf.get(t) ?? Math.log(2)
  const massA = [...A].reduce((s, t) => s + weight(t), 0)
  const massB = [...B].reduce((s, t) => s + weight(t), 0)

  const shared = [...A].filter((t) => B.has(t))
  const sharedMass = shared.reduce((s, t) => s + weight(t), 0)
  const denom = Math.min(massA, massB)

  return {
    weightedCoverage: denom === 0 ? 0 : Math.round((sharedMass / denom) * 1000) / 1000,
    sharedTerms: shared
      .map((token) => ({ token, salience: Math.round(weight(token) * 100) / 100 }))
      .sort((x, y) => y.salience - x.salience),
  }
}

/**
 * Hard conflicts are name collisions across scopes. They are reported as "rename
 * one", deliberately NOT as "the project one wins": which scope takes precedence
 * is not something this tool verifies, and guessing at an order that decides
 * whether the developer's own skill still works is the wrong place to be confident.
 */
/**
 * Thresholds calibrated against a real 20-skill corpus rather than guessed:
 *   - weighted coverage: the one genuine competitor scored 0.199, the highest
 *     unrelated skill 0.075, so 0.12 sits in the gap.
 *   - phrase salience: a shared phrase is scored by the corpus salience of its
 *     words, not its length. "time tracking" between two real competitors scored
 *     3.47; the boilerplate "or set up" between unrelated skills scored 1.79.
 *     Counting words instead would rank those equally.
 */
export function findConflicts(repoSkills, otherSkills, { minCoverage = 0.12, minPhraseSalience = 2.5 } = {}) {
  const conflicts = []
  const idf = buildIdf([...repoSkills, ...otherSkills])

  for (const mine of repoSkills) {
    for (const other of otherSkills) {
      if (other.file === mine.file) continue

      const phrases = sharedPhrases(mine.description, other.description)
      const { weightedCoverage, sharedTerms } = salientOverlap(mine.description, other.description, idf)
      const phraseSalience = phrases.map((p) => ({ phrase: p, salience: phraseSalienceOf(p, idf) }))
      const topPhraseSalience = phraseSalience.reduce((m, p) => Math.max(m, p.salience), 0)
      const evidence = {
        sharedPhrases: phrases,
        phraseSalience,
        sharedTerms: sharedTerms.slice(0, 12),
        weightedCoverage,
        jaccard: jaccard(mine.description, other.description),
      }

      if (other.name === mine.name || other.dirName === mine.dirName) {
        conflicts.push({
          kind: 'hard',
          repoSkill: mine.name,
          other: pick(other),
          reason: `both are named "${other.name}" but live in different scopes`,
          resolution:
            'Rename one of them. Which scope wins is not verified by this tool, so relying on precedence risks silently shadowing your own skill.',
          ...evidence,
          score: 999,
        })
        continue
      }

      // Either signal can raise a conflict: a distinctive shared phrase is direct
      // evidence, and high salient coverage catches the paraphrased overlaps that
      // phrase matching cannot see.
      const salientPhrases = phraseSalience.filter((p) => p.salience >= minPhraseSalience)
      if (salientPhrases.length > 0 || weightedCoverage >= minCoverage) {
        // Salience gates whether a conflict is RAISED. Once it is, every shared phrase
        // is worth showing - it is the most readable evidence the developer gets, and
        // suppressing it because it sat below the trigger bar just hides the reason.
        const reasons = []
        if (phrases.length) {
          reasons.push(`shares the phrase${phrases.length === 1 ? '' : 's'} ${phrases.map((p) => `"${p}"`).join(', ')}`)
        }
        if (weightedCoverage >= minCoverage) {
          reasons.push(
            `${Math.round(weightedCoverage * 100)}% of its distinctive terms also appear here (${sharedTerms
              .slice(0, 5)
              .map((t) => t.token)
              .join(', ')})`,
          )
        }
        conflicts.push({
          kind: 'soft',
          repoSkill: mine.name,
          other: pick(other),
          reason: reasons.join('; '),
          ...evidence,
          score: Math.round((topPhraseSalience + weightedCoverage * 10) * 100) / 100,
        })
      }
    }
  }

  return conflicts.sort((a, b) => b.score - a.score || a.other.name.localeCompare(b.other.name))
}

function phraseSalienceOf(phrase, idf) {
  const total = phrase
    .split(' ')
    .filter((w) => !STOPWORDS.has(w))
    .reduce((s, w) => s + (idf.get(w) ?? 0), 0)
  return Math.round(total * 100) / 100
}

function pick(skill) {
  return {
    name: skill.name,
    scope: skill.scope,
    file: skill.file,
    source: skill.source,
    description: skill.description,
  }
}
