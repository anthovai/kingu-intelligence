import { marked } from 'marked'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

/**
 * The page an artifact is shared as (`renderedContentType` is always
 * `text/html`): HTML as written, Markdown rendered into a plain readable page.
 * Either way it is served sandboxed (see `SHARED_PAGE_HEADERS`), so what it
 * contains cannot reach this origin.
 */
export function renderArtifact(contentType: 'text/html' | 'text/markdown', content: string, title: string | null): string {
  if (contentType === 'text/html') {
    return content
  }
  const body = marked.parse(content, { async: false, gfm: true }) as string
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title ?? 'Artifact')}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0 auto; max-width: 820px; padding: 32px 20px 64px; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  pre { overflow-x: auto; padding: 12px; border-radius: 6px; background: rgb(127 127 127 / 0.12); }
  code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 0.92em; }
  table { border-collapse: collapse; }
  th, td { padding: 4px 10px; border: 1px solid rgb(127 127 127 / 0.35); }
  img { max-width: 100%; }
</style>
</head>
<body>
${body}
</body>
</html>`
}

/** A small page for a missing, expired or unshared artifact. */
export function notFoundPage(): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body style="font:16px system-ui;padding:40px">This artifact is not shared, or its link has expired.</body></html>'
}

/**
 * Headers for a shared page. `sandbox` gives it an opaque origin, so its
 * scripts run but cannot read or act as this API; framing stays allowed
 * because the desktop previews the page in a webview (`?embed=1`).
 */
export const SHARED_PAGE_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store'
}
