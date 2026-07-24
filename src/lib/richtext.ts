/**
 * Tiny, dependency-free rich-text helpers shared by the quote builder (client)
 * and the printable quote page (server). Descriptions may hold a small subset
 * of formatting — bold, underline, and bullet lists — produced by the
 * RichTextEditor. Everything is normalized to a safe HTML allowlist so it can
 * be rendered with `dangerouslySetInnerHTML` without opening an XSS hole.
 *
 * Legacy descriptions were plain text (with newlines); those are detected and
 * converted to HTML so old quotes keep rendering exactly as before.
 */

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'br', 'p']);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** True when the string carries no HTML markup (i.e. it's legacy plain text). */
function looksLikePlainText(s: string): boolean {
  return !/<[a-z/][^>]*>/i.test(s);
}

/**
 * Sanitize a stored description into safe HTML.
 *  - Plain text → escaped, with newlines turned into <br>.
 *  - HTML → script/style/comments removed, only allowlisted tags kept (with all
 *    attributes stripped); disallowed tags are dropped but their text remains.
 */
export function sanitizeRichText(input: string | null | undefined): string {
  const raw = (input ?? '').toString();
  if (raw.trim() === '') return '';

  if (looksLikePlainText(raw)) {
    return escapeHtml(raw).replace(/\r?\n/g, '<br>');
  }

  return (
    raw
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)\b[^>]*?>/g, (_m, slash: string, name: string) => {
        const tag = name.toLowerCase();
        // contentEditable wraps each new line in a <div>; keep the line break
        // (as <br>) instead of silently joining the lines when dropping the tag.
        if (tag === 'div') return slash ? '' : '<br>';
        if (!ALLOWED_TAGS.has(tag)) return '';
        if (tag === 'br') return '<br>';
        return `<${slash ? '/' : ''}${tag}>`;
      })
      // The first line often gets div-wrapped too — don't let it become a
      // leading blank line.
      .replace(/^(\s*<br>)+/, '')
  );
}

/**
 * Build a bullet-list description (the RichTextEditor's HTML shape) from plain
 * text lines — used by imports that read bullets out of a PDF. Empty lines are
 * dropped; returns '' when nothing remains.
 */
export function bulletsToRichText(lines: string[]): string {
  const items = lines.map((l) => l.trim()).filter(Boolean);
  if (items.length === 0) return '';
  return `<ul>${items.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
}

/**
 * Plain-text projection of a description, used to decide whether a field is
 * effectively empty (an "empty" contentEditable often still holds <br> etc.).
 */
export function richTextToPlain(input: string | null | undefined): string {
  const raw = (input ?? '').toString();
  if (looksLikePlainText(raw)) return raw.trim();
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

/** Whether a description has no visible content. */
export function isRichTextEmpty(input: string | null | undefined): boolean {
  return richTextToPlain(input) === '';
}
