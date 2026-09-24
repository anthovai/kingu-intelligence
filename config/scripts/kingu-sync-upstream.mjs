// Brings upstream Orca into Kingu, keeping everything Kingu changed.
//
//   node config/scripts/kingu-sync-upstream.mjs <base> <upstream>
//
// Run on a branch at Kingu's head, after `git merge -s ours --no-commit <upstream>`
// (so the result is a merge commit with both parents). <base> is the upstream commit
// Kingu last synced from. For every file:
//
// - upstream left it as it was at <base>: Kingu's file, exactly (hand edits included);
// - upstream changed it: upstream's file, rebranded (kingu-rebrand.mjs) and formatted;
//   if Kingu had also changed it beyond the rebrand, a three-way merge of the two, and
//   the file is listed for review;
// - upstream added it: rebranded and formatted; upstream deleted it: deleted;
// - Kingu added it: kept.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rebrandPath, rebrandText } from './kingu-rebrand.mjs'

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
  '..'
)
const [base, upstream] = process.argv.slice(2)
if (!base || !upstream) {
  console.error('usage: kingu-sync-upstream.mjs <base> <upstream>')
  process.exit(2)
}
const BINARY =
  /\.(png|jpe?g|gif|webp|ico|icns|bmp|ttf|otf|woff2?|mp3|mp4|wav|zip|gz|tgz|node|wasm|pdf|sqlite|jar|keystore|bin)$/i
const FORMATTED = /\.(m?[jt]sx?|cjs|json|jsonc|css|md|mdx|ya?ml|html|vue)$/i

const git = (args, options = {}) =>
  execFileSync('git', ['-C', ROOT, ...args], { maxBuffer: 1 << 30, ...options })

function tree(commit) {
  const map = new Map()
  for (const line of git([
    'ls-tree',
    '-r',
    '-z',
    '--format=%(objectmode) %(objectname) %(path)',
    commit
  ])
    .toString()
    .split('\0')) {
    if (!line) {
      continue
    }
    const [mode, oid, ...rest] = line.split(' ')
    if (mode !== '160000') {
      map.set(rest.join(' '), { mode, oid })
    }
  }
  return map
}

const blob = (oid) => git(['cat-file', 'blob', oid])
const isBinary = (file, bytes) => BINARY.test(file) || bytes.includes(0)
const squash = (text) => text.replace(/\s+/g, '')

const B = tree(base)
const U = tree(upstream)
const O = tree('HEAD')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kingu-sync-'))

// Formats a batch of texts with the repo's own formatter, keyed by the path they will live at.
function formatAll(entries) {
  const dir = path.join(tmp, `fmt-${Math.random().toString(36).slice(2)}`)
  const written = []
  for (const [target, text] of entries) {
    if (!FORMATTED.test(target)) {
      continue
    }
    const file = path.join(dir, target)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    written.push(file)
  }
  if (written.length) {
    fs.copyFileSync(path.join(ROOT, '.oxfmtrc.json'), path.join(dir, '.oxfmtrc.json'))
    const oxfmt = path.join(
      ROOT,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'oxfmt.cmd' : 'oxfmt'
    )
    for (let i = 0; i < written.length; i += 200) {
      try {
        execFileSync(
          oxfmt,
          ['--write', ...written.slice(i, i + 200).map((f) => path.relative(dir, f))],
          { cwd: dir, stdio: 'pipe', shell: process.platform === 'win32' }
        )
      } catch {
        // A file oxfmt cannot parse stays as rebranded.
      }
    }
  }
  const out = new Map()
  for (const [target, text] of entries) {
    const file = path.join(dir, target)
    out.set(
      target,
      FORMATTED.test(target) && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : text
    )
  }
  return out
}

const result = new Map() // target path -> { bytes } | { oid } | null (delete)
const toFormat = []
const unchanged = []
const review = []
const derived = new Set()

for (const [file, u] of U) {
  const target = rebrandPath(file)
  derived.add(target)
  const b = B.get(file)
  const o = O.get(target)
  if (b && b.oid === u.oid) {
    // Upstream left it alone: Kingu's version, or Kingu's deletion.
    result.set(target, o ? { oid: o.oid } : null)
    continue
  }
  const bytes = blob(u.oid)
  if (isBinary(file, bytes)) {
    // Kingu replaced some binaries (its icons); upstream changing one too is for review.
    if (o && b && o.oid !== b.oid) {
      review.push(`${target} (binary, both changed; kept Kingu's)`)
    }
    result.set(target, o && b && o.oid !== b.oid ? { oid: o.oid } : { oid: u.oid })
    continue
  }
  const original = bytes.toString('utf8')
  const rebranded = rebrandText(original)
  // Only what the rebrand changed is reformatted; upstream's own formatting is left as it is.
  if (rebranded === original) {
    unchanged.push([target, original])
  } else {
    toFormat.push([target, rebranded])
  }
}
const formatted = new Map([...formatAll(toFormat), ...unchanged])

// Kingu's changes beyond the rebrand, on files upstream also changed: three-way merge.
const upstreamPathOf = new Map([...U.keys()].map((f) => [rebrandPath(f), f]))
for (const [target, text] of formatted) {
  result.set(target, { bytes: Buffer.from(text) })
}
const bothChanged = []
const baseTexts = []
const baseUnchanged = []
for (const [target] of formatted) {
  const b = B.get(upstreamPathOf.get(target))
  const o = O.get(target)
  if (!b || !o) {
    continue
  }
  const baseOriginal = blob(b.oid).toString('utf8')
  const baseText = rebrandText(baseOriginal)
  if (squash(blob(o.oid).toString('utf8')) !== squash(baseText)) {
    bothChanged.push(target)
    ;(baseText === baseOriginal ? baseUnchanged : baseTexts).push([target, baseText])
  }
}
const formattedBase = new Map([...formatAll(baseTexts), ...baseUnchanged])
const mergeDir = path.join(tmp, 'merge')
fs.mkdirSync(mergeDir, { recursive: true })
for (const target of bothChanged) {
  const [oursFile, baseFile, theirsFile] = ['ours', 'base', 'theirs'].map((n) =>
    path.join(mergeDir, n)
  )
  fs.writeFileSync(oursFile, blob(O.get(target).oid))
  fs.writeFileSync(baseFile, formattedBase.get(target))
  fs.writeFileSync(theirsFile, result.get(target).bytes)
  let clean = true
  try {
    execFileSync(
      'git',
      ['merge-file', '-L', 'kingu', '-L', 'base', '-L', 'upstream', oursFile, baseFile, theirsFile],
      { stdio: 'pipe' }
    )
  } catch {
    clean = false
  }
  result.set(target, { bytes: fs.readFileSync(oursFile) })
  review.push(`${target}${clean ? ' (merged cleanly)' : ' (CONFLICT markers)'}`)
}

// Upstream deletions, and Kingu's own files.
const baseTargets = new Set([...B.keys()].map((f) => rebrandPath(f)))
for (const [file] of B) {
  const target = rebrandPath(file)
  if (!U.has(file) && !derived.has(target)) {
    result.set(target, null)
  }
}
for (const [target, o] of O) {
  if (!result.has(target) && !baseTargets.has(target)) {
    result.set(target, { oid: o.oid })
  }
}

// Write the tree into the working copy and the index.
let written = 0
let removed = 0
for (const [target, entry] of result) {
  const full = path.join(ROOT, target)
  if (entry === null) {
    if (fs.existsSync(full)) {
      fs.rmSync(full, { force: true })
      removed++
    }
    continue
  }
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, entry.bytes ?? blob(entry.oid))
  written++
}
for (const [target] of O) {
  // A base file Kingu kept that upstream deleted without a rebranded successor.
  if (!result.has(target) && baseTargets.has(target)) {
    fs.rmSync(path.join(ROOT, target), { force: true })
    removed++
  }
}
console.log(`wrote ${written} files, removed ${removed}`)
console.log(`review (${review.length}):`)
for (const line of review) {
  console.log(`  ${line}`)
}
