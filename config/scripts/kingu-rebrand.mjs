// Rebrands an Orca tree as Kingu: the text in every file and every path segment.
//
//   node config/scripts/kingu-rebrand.mjs --write          rebrand the working tree in place
//   node config/scripts/kingu-rebrand.mjs --check A B      apply to commit A in memory and report where it differs from commit B
//
// Why: the rebrand has to be re-applied every time upstream is merged. Done by hand it
// conflicts on every file upstream touches; as a script, a sync is "take upstream, run this".
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
  '..'
)

// Order matters: the repository slug before the org, the org before the product.
const TEXT_RULES = [
  [/stablyai\/orca/g, 'anthovai/kingu-intelligence'],
  [/stablyai/g, 'anthovai'],
  [/Orca/g, 'Kingu'],
  [/orca/g, 'kingu'],
  [/ORCA/g, 'KINGU']
]

// Files the rebrand leaves alone: binaries, and text that must match bytes elsewhere.
const BINARY =
  /\.(png|jpe?g|gif|webp|ico|icns|bmp|ttf|otf|woff2?|mp3|mp4|wav|zip|gz|tgz|node|wasm|pdf|sqlite|jar|keystore|bin)$/i

// npm packages published under the upstream org keep their real names: renaming
// `@stablyai/playwright-test` breaks every install and import that uses it.
const KEPT = [/@stablyai\/playwright/g]
const KEPT_MARK = '\u0000kingu-kept\u0000'

export function rebrandText(text) {
  const kept = []
  let out = text
  for (const pattern of KEPT) {
    out = out.replace(pattern, (match) => {
      kept.push(match)
      return `${KEPT_MARK}${kept.length - 1}${KEPT_MARK}`
    })
  }
  for (const [pattern, replacement] of TEXT_RULES) {
    out = out.replace(pattern, replacement)
  }
  return out.replace(
    new RegExp(`${KEPT_MARK}(\\d+)${KEPT_MARK}`, 'g'),
    (_, index) => kept[Number(index)]
  )
}

export function rebrandPath(file) {
  return file
    .split('/')
    .map((segment) => rebrandText(segment))
    .join('/')
}

function git(args, options = {}) {
  return execFileSync('git', ['-C', ROOT, ...args], { maxBuffer: 1 << 30, ...options })
}

function treeFiles(commit) {
  return git(['ls-tree', '-r', '-z', '--format=%(objectmode) %(objectname) %(path)', commit])
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [mode, oid, ...rest] = line.split(' ')
      return { mode, oid, path: rest.join(' ') }
    })
}

function readBlobs(oids) {
  // One cat-file for all blobs; each entry is "<oid> blob <size>\n<bytes>\n".
  const out = git(['cat-file', '--batch'], { input: `${oids.join('\n')}\n` })
  const blobs = new Map()
  let at = 0
  while (at < out.length) {
    const end = out.indexOf(10, at)
    const [oid, , size] = out.subarray(at, end).toString().split(' ')
    const start = end + 1
    blobs.set(oid, out.subarray(start, start + Number(size)))
    at = start + Number(size) + 1
  }
  return blobs
}

function rebrandTree(commit) {
  const files = treeFiles(commit).filter((f) => f.mode !== '160000')
  const blobs = readBlobs([...new Set(files.map((f) => f.oid))])
  const result = new Map()
  for (const f of files) {
    const bytes = blobs.get(f.oid)
    const text = BINARY.test(f.path) || bytes.includes(0) ? null : bytes.toString('utf8')
    result.set(rebrandPath(f.path), text === null ? { binary: f.oid } : { text: rebrandText(text) })
  }
  return result
}

function check(from, to) {
  const produced = rebrandTree(from)
  const target = treeFiles(to).filter((f) => f.mode !== '160000')
  const blobs = readBlobs([...new Set(target.map((f) => f.oid))])
  const differs = []
  const missing = []
  const seen = new Set()
  for (const f of target) {
    seen.add(f.path)
    const want = produced.get(f.path)
    if (!want) {
      missing.push(f.path)
      continue
    }
    if (want.binary) {
      if (want.binary !== f.oid) {
        differs.push(`${f.path} (binary)`)
      }
      continue
    }
    if (want.text !== blobs.get(f.oid).toString('utf8')) {
      differs.push(f.path)
    }
  }
  const extra = [...produced.keys()].filter((p) => !seen.has(p))
  console.log(
    `differs: ${differs.length}, only in target: ${missing.length}, only in produced: ${extra.length}`
  )
  for (const p of differs) {
    console.log(`  differs  ${p}`)
  }
  for (const p of missing.slice(0, 50)) {
    console.log(`  target+  ${p}`)
  }
  for (const p of extra.slice(0, 50)) {
    console.log(`  produced+ ${p}`)
  }
}

function writeWorkingTree() {
  const files = git(['ls-files', '-z']).toString().split('\0').filter(Boolean)
  let renamed = 0
  let rewritten = 0
  for (const file of files) {
    // These two name Orca on purpose: their rules and their docs.
    if (
      file === 'config/scripts/kingu-rebrand.mjs' ||
      file === 'config/scripts/kingu-sync-upstream.mjs'
    ) {
      continue
    }
    const full = path.join(ROOT, file)
    if (!fs.existsSync(full) || fs.lstatSync(full).isSymbolicLink()) {
      continue
    }
    if (!BINARY.test(file)) {
      const bytes = fs.readFileSync(full)
      if (!bytes.includes(0)) {
        const text = bytes.toString('utf8')
        const next = rebrandText(text)
        if (next !== text) {
          fs.writeFileSync(full, next)
          rewritten++
        }
      }
    }
    const target = rebrandPath(file)
    if (target !== file) {
      git(['mv', '-f', '--', file, target])
      renamed++
    }
  }
  console.log(`rewrote ${rewritten} files, renamed ${renamed}`)
}

const [mode, a, b] = process.argv.slice(2)
const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (!isMain) {
  // Imported, not run.
} else if (mode === '--check') {
  check(a, b)
} else if (mode === '--write') {
  writeWorkingTree()
} else {
  console.error('usage: kingu-rebrand.mjs --write | --check <from> <to>')
  process.exit(2)
}
