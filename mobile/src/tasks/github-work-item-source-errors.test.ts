import { describe, expect, it } from 'vitest'
import {
  extractGitHubIssueSourceError,
  extractGitHubIssueSourceFallback
} from './github-work-item-source-errors'

describe('extractGitHubIssueSourceError', () => {
  it('keeps the failing issue source slug with the repo that produced it', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/kingu' },
        {
          sources: { issues: { owner: 'upstream', repo: 'kingu' } },
          errors: { issues: { message: 'HTTP 403: resource not accessible' } }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/kingu',
      source: { owner: 'upstream', repo: 'kingu' },
      message: 'HTTP 403: resource not accessible'
    })
  })

  it('drops issue errors when the source slug is unavailable', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/kingu' },
        {
          sources: { issues: null },
          errors: { issues: { message: 'failed' } }
        }
      )
    ).toBeNull()
  })

  it('returns null when the envelope has no issue-side error', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/kingu' },
        {
          sources: { issues: { owner: 'anthovai', repo: 'kingu' } }
        }
      )
    ).toBeNull()
  })
})

describe('extractGitHubIssueSourceFallback', () => {
  it('reports the repo whose upstream issue source fell back to origin', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/kingu', displayName: 'kingu' },
        {
          issueSourceFellBack: true,
          sources: {
            issues: { owner: 'anthovai', repo: 'kingu-fork' },
            prs: { owner: 'anthovai', repo: 'kingu' }
          }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/kingu',
      repoLabel: 'anthovai/kingu-intelligence'
    })
  })

  it('uses the Kingu repo display name when the PR source is unavailable', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/kingu', displayName: 'kingu' },
        {
          issueSourceFellBack: true,
          sources: { issues: null, prs: null }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/kingu',
      repoLabel: 'kingu'
    })
  })

  it('returns null when the source resolver did not fall back', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/kingu', displayName: 'kingu' },
        {
          sources: { issues: { owner: 'anthovai', repo: 'kingu' } }
        }
      )
    ).toBeNull()
  })
})
