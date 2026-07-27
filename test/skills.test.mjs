import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildIdf,
  discoverSkills,
  findConflicts,
  parseFrontmatter,
  quotedPhrases,
  salientOverlap,
  sharedPhrases,
  skillRoots,
} from '../src/skills.mjs'
import { tempDataDir } from './helpers.mjs'

function fixtureRoot(t, skills) {
  const root = path.join(tempDataDir(t), 'skills')
  for (const [name, body] of Object.entries(skills)) {
    mkdirSync(path.join(root, name), { recursive: true })
    writeFileSync(path.join(root, name, 'SKILL.md'), body)
  }
  return root
}

describe('frontmatter parsing', () => {
  // A naive /description:\s*(.*)$/ returns '' for a folded scalar, and then every
  // overlap check silently passes while looking like it works. This is the regression
  // guard for that specific trap.
  test('a folded (>) description parses to its full text', () => {
    const fm = parseFrontmatter(`---
name: timesheet
description: >
  Reconstruct weekly timesheets from calendar and chat.
  Use this whenever the user mentions timesheets, time tracking,
  logging hours, or asks "what did I work on".
---

# body`)
    assert.equal(fm.name, 'timesheet')
    assert.ok(fm.description.length > 80, `expected the full description, got ${JSON.stringify(fm.description)}`)
    assert.match(fm.description, /logging hours/)
    // Folded style joins lines within a paragraph with a space.
    assert.doesNotMatch(fm.description, /\n/)
  })

  test('a literal (|) description keeps its line breaks', () => {
    const fm = parseFrontmatter(`---
name: literal
description: |
  first line
  second line
---`)
    assert.equal(fm.description, 'first line\nsecond line')
  })

  test('block scalar indicators with modifiers are handled', () => {
    for (const marker of ['>-', '>+', '|-', '|2']) {
      const fm = parseFrontmatter(`---\nname: n\ndescription: ${marker}\n  some text here\n---`)
      assert.match(fm.description, /some text here/, `failed for ${marker}`)
    }
  })

  test('plain and quoted single-line descriptions parse', () => {
    assert.equal(parseFrontmatter('---\nname: a\ndescription: plain text\n---').description, 'plain text')
    assert.equal(parseFrontmatter('---\nname: a\ndescription: "quoted text"\n---').description, 'quoted text')
    assert.equal(parseFrontmatter("---\nname: a\ndescription: 'single'\n---").description, 'single')
  })

  test('multiple paragraphs in a folded scalar are preserved as separate lines', () => {
    const fm = parseFrontmatter(`---
description: >
  first paragraph line one
  line two

  second paragraph
---`)
    assert.equal(fm.description, 'first paragraph line one line two\nsecond paragraph')
  })

  test('a file with no frontmatter yields nothing rather than throwing', () => {
    assert.deepEqual(parseFrontmatter('# just a heading\n'), {})
  })

  test('a key following a block scalar is still parsed', () => {
    const fm = parseFrontmatter(`---
description: >
  folded text
name: after-block
---`)
    assert.equal(fm.name, 'after-block')
    assert.match(fm.description, /folded text/)
  })
})

describe('discovery', () => {
  test('TRACKER_SKILL_ROOTS overrides the real roots', (t) => {
    const root = fixtureRoot(t, { alpha: '---\nname: alpha\ndescription: does alpha things\n---' })
    const roots = skillRoots({ TRACKER_SKILL_ROOTS: root })
    assert.deepEqual(roots, [{ dir: root, scope: 'fixture' }])
    const found = discoverSkills(roots)
    assert.equal(found.length, 1)
    assert.equal(found[0].name, 'alpha')
  })

  test('the real roots include the user and project scopes', () => {
    const scopes = new Set(skillRoots({}).map((r) => r.scope))
    assert.ok(scopes.has('user'))
    assert.ok(scopes.has('project'))
  })

  test('directories without a SKILL.md are skipped', (t) => {
    const root = fixtureRoot(t, { real: '---\nname: real\ndescription: x\n---' })
    mkdirSync(path.join(root, 'empty-dir'), { recursive: true })
    assert.equal(discoverSkills([{ dir: root, scope: 'fixture' }]).length, 1)
  })

  test('the directory name is the fallback when frontmatter has no name', (t) => {
    const root = fixtureRoot(t, { 'no-name': '---\ndescription: something\n---' })
    assert.equal(discoverSkills([{ dir: root, scope: 'fixture' }])[0].name, 'no-name')
  })
})

describe('phrase extraction', () => {
  test('quoted example utterances are picked up', () => {
    const found = quotedPhrases('trigger when the user asks "what did I work on" today')
    assert.ok(found.has('what did i work on'))
  })

  test('shared phrases are reduced to the maximal ones', () => {
    const shared = sharedPhrases('please log my working hours today', 'remember to log my working hours')
    assert.ok(shared.includes('log my working hours'))
    // The contained 2- and 3-grams add nothing but noise.
    assert.equal(shared.some((p) => p === 'log my'), false)
  })

  test('boilerplate made only of stopwords is not a shared phrase', () => {
    const shared = sharedPhrases(
      'Use this skill when the user wants to do something',
      'Use this skill when the user wants to do anything',
    )
    assert.deepEqual(shared, [])
  })

  test('unrelated descriptions share nothing', () => {
    assert.deepEqual(sharedPhrases('rotate and merge PDF files', 'start and stop a running timer'), [])
  })
})

describe('salient overlap', () => {
  test('terms shared by few skills weigh more than common vocabulary', (t) => {
    const corpus = [
      { description: 'tracks time and logs hours for projects' },
      { description: 'reconstructs timesheets and logs hours for projects' },
      { description: 'converts spreadsheet files for projects' },
      { description: 'renders slide decks for projects' },
      { description: 'edits word documents for projects' },
    ]
    const idf = buildIdf(corpus)
    // "projects" appears everywhere, so it must carry less weight than "hours".
    assert.ok(idf.get('hours') > idf.get('projects'))

    const competing = salientOverlap(corpus[0].description, corpus[1].description, idf).weightedCoverage
    const unrelated = salientOverlap(corpus[0].description, corpus[2].description, idf).weightedCoverage
    assert.ok(competing > unrelated, `competing ${competing} should exceed unrelated ${unrelated}`)
  })

  test('an empty description overlaps with nothing', () => {
    const idf = buildIdf([{ description: 'a b c' }])
    assert.equal(salientOverlap('', 'anything', idf).weightedCoverage, 0)
  })
})

describe('conflict detection', () => {
  const TRACKER = {
    name: 'time-tracking',
    dirName: 'time-tracking',
    scope: 'project',
    file: '/repo/.claude/skills/time-tracking/SKILL.md',
    description:
      'Live time tracking for parallel work. Use when the user started or stopped working on something, wants to clock in or out, asks to log time or track time against a project, or wants today or this week hours.',
  }

  const TIMESHEET = {
    name: 'timesheet',
    dirName: 'timesheet',
    scope: 'user',
    source: 'custom',
    file: '/home/me/.claude/skills/timesheet/SKILL.md',
    description:
      'Reconstruct weekly timesheets from calendar and chat. Use whenever the user mentions timesheets, time tracking, logging hours, recording work hours, billable hours, or asks what did I work on.',
  }

  const UNRELATED = {
    name: 'pdf',
    dirName: 'pdf',
    scope: 'user',
    source: 'anthropic-example',
    file: '/home/me/.claude/skills/pdf/SKILL.md',
    description: 'Read, merge, split, rotate and watermark PDF files, fill forms and run OCR on scans.',
  }

  test('a genuine competitor is reported with the shared phrase quoted', () => {
    const conflicts = findConflicts([TRACKER], [TIMESHEET, UNRELATED])
    const hit = conflicts.find((c) => c.other.name === 'timesheet')
    assert.ok(hit, 'the competing skill must be reported')
    assert.equal(hit.kind, 'soft')
    assert.ok(hit.sharedPhrases.includes('time tracking'))
    assert.match(hit.reason, /time tracking/)
    // The source matters: a stock example is a softer conflict than the user's own.
    assert.equal(hit.other.source, 'custom')
  })

  test('an unrelated skill is not reported', () => {
    const conflicts = findConflicts([TRACKER], [TIMESHEET, UNRELATED])
    assert.equal(
      conflicts.some((c) => c.other.name === 'pdf'),
      false,
    )
  })

  test('a name collision across scopes is hard, and says to rename', () => {
    const shadow = { ...UNRELATED, name: 'time-tracking', dirName: 'time-tracking' }
    const conflicts = findConflicts([TRACKER], [shadow])
    assert.equal(conflicts[0].kind, 'hard')
    assert.match(conflicts[0].reason, /both are named/)
    // Deliberately not "the project one wins": precedence is unverified.
    assert.match(conflicts[0].resolution, /Rename one/)
    assert.doesNotMatch(conflicts[0].resolution, /project wins/)
  })

  test('hard conflicts sort above soft ones', () => {
    const shadow = { ...UNRELATED, name: 'time-tracking', dirName: 'time-tracking' }
    const conflicts = findConflicts([TRACKER], [shadow, TIMESHEET])
    assert.equal(conflicts[0].kind, 'hard')
  })

  test('a skill is never reported as conflicting with itself', () => {
    assert.deepEqual(findConflicts([TRACKER], [TRACKER]), [])
  })

  test('the report is deterministic across runs', () => {
    const first = findConflicts([TRACKER], [TIMESHEET, UNRELATED])
    const second = findConflicts([TRACKER], [TIMESHEET, UNRELATED])
    assert.deepEqual(first, second)
  })

  test('phrase salience, not word count, decides a phrase-only conflict', () => {
    // "or set up" is three words of boilerplate; it must not raise a conflict on its own.
    const a = { name: 'a', dirName: 'a', scope: 'project', file: '/a', description: 'Install or set up the tracker on a new machine.' }
    const b = { name: 'b', dirName: 'b', scope: 'user', file: '/b', description: 'Render a brief, or set up a recurring weekday task.' }
    assert.deepEqual(findConflicts([a], [b]), [])
  })
})
