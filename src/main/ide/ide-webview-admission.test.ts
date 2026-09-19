import { beforeEach, describe, expect, it } from 'vitest'
import { IDE_PARTITION } from '../../shared/ide-partition'
import {
  admitIdeOrigin,
  getAdmittedIdeOrigin,
  isAdmissibleIdeAttach,
  revokeIdeOrigin
} from './ide-webview-admission'

const SERVER_URL = 'http://127.0.0.1:51234/?tkn=secret&folder=C%3A%2Fwork'

describe('ide webview admission', () => {
  beforeEach(() => {
    revokeIdeOrigin()
  })

  it('admits the running server on the IDE partition', () => {
    admitIdeOrigin(SERVER_URL)
    expect(isAdmissibleIdeAttach(IDE_PARTITION, SERVER_URL)).toBe(true)
  })

  it('ignores the query string so a reload without the token still attaches', () => {
    admitIdeOrigin(SERVER_URL)
    expect(isAdmissibleIdeAttach(IDE_PARTITION, 'http://127.0.0.1:51234/')).toBe(true)
  })

  it('refuses every attach while no server is running', () => {
    expect(isAdmissibleIdeAttach(IDE_PARTITION, SERVER_URL)).toBe(false)
  })

  // Why: a stopped server's port can be reused by anything else on the machine.
  it('refuses the origin again after the server stops', () => {
    admitIdeOrigin(SERVER_URL)
    revokeIdeOrigin()
    expect(isAdmissibleIdeAttach(IDE_PARTITION, SERVER_URL)).toBe(false)
    expect(getAdmittedIdeOrigin()).toBeNull()
  })

  it('refuses a different port on the same host', () => {
    admitIdeOrigin(SERVER_URL)
    expect(isAdmissibleIdeAttach(IDE_PARTITION, 'http://127.0.0.1:51235/')).toBe(false)
  })

  it('refuses the admitted origin on any other partition', () => {
    admitIdeOrigin(SERVER_URL)
    expect(isAdmissibleIdeAttach('persist:browser-profile-1', SERVER_URL)).toBe(false)
    expect(isAdmissibleIdeAttach('', SERVER_URL)).toBe(false)
  })

  // Why: the origin is minted from a loopback bind, so a non-loopback host can
  // only come from a renderer that built its own src.
  it('never admits a non-loopback host', () => {
    admitIdeOrigin('http://evil.example.com:51234/')
    expect(getAdmittedIdeOrigin()).toBeNull()
    expect(isAdmissibleIdeAttach(IDE_PARTITION, 'http://evil.example.com:51234/')).toBe(false)
  })

  it('treats an unparseable src as inadmissible', () => {
    admitIdeOrigin(SERVER_URL)
    expect(isAdmissibleIdeAttach(IDE_PARTITION, 'not a url')).toBe(false)
    expect(isAdmissibleIdeAttach(IDE_PARTITION, '')).toBe(false)
  })

  it('replaces the previous origin when the server restarts on a new port', () => {
    admitIdeOrigin(SERVER_URL)
    admitIdeOrigin('http://127.0.0.1:60000/')
    expect(isAdmissibleIdeAttach(IDE_PARTITION, SERVER_URL)).toBe(false)
    expect(isAdmissibleIdeAttach(IDE_PARTITION, 'http://127.0.0.1:60000/')).toBe(true)
  })
})
