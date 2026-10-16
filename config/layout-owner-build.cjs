const { existsSync } = require('node:fs')
const { join } = require('node:path')

// The dark layout-owner switch (src/shared/layout-owner-switch.ts): a build compiles it in only
// when KINGU_LAYOUT_OWNER=main asks. Such a main build leaves this marker in out/main, and packaging
// refuses it; packaging and the kingud template also refuse the variable itself.
const LAYOUT_OWNER_MARKER_FILENAME = 'KINGU_LAYOUT_OWNER_MAIN'
const LAYOUT_OWNER_MARKER_TEXT = 'Built with KINGU_LAYOUT_OWNER=main, for dark testing only.\n'

function isLayoutOwnerBuild(env = process.env) {
  return env.KINGU_LAYOUT_OWNER === 'main'
}

/** The `KINGU_LAYOUT_OWNER` define: 'main' only when asked, so other builds fold the branches away. */
function layoutOwnerDefine(env = process.env) {
  return JSON.stringify(isLayoutOwnerBuild(env) ? 'main' : 'window')
}

function assertNotLayoutOwnerBuild(outputDirs, env = process.env) {
  if (isLayoutOwnerBuild(env)) {
    throw new Error(
      'KINGU_LAYOUT_OWNER=main is for dark test builds; unset it to package a release.'
    )
  }
  const marked = outputDirs.find((dir) => existsSync(join(dir, LAYOUT_OWNER_MARKER_FILENAME)))
  if (marked) {
    throw new Error(
      `${marked} holds an KINGU_LAYOUT_OWNER=main build; rebuild it without that variable first.`
    )
  }
}

module.exports = {
  LAYOUT_OWNER_MARKER_FILENAME,
  LAYOUT_OWNER_MARKER_TEXT,
  assertNotLayoutOwnerBuild,
  isLayoutOwnerBuild,
  layoutOwnerDefine
}
