import hljs from 'highlight.js';
import { Marked } from 'marked';

const marked = new Marked({
  renderer: {
    code(this: unknown, ...args: unknown[]) {
      const token = (typeof args[0] === 'object' ? args[0] : { text: args[0], lang: args[1] }) as {
        text: string;
        lang?: string;
      };
      const highlighted =
        token.lang && hljs.getLanguage(token.lang)
          ? hljs.highlight(token.text, { language: token.lang, ignoreIllegals: true }).value
          : hljs.highlightAuto(token.text).value;
      return `<pre><code class="hljs">${highlighted}</code></pre>`;
    },
  },
});

/** Render a markdown string to HTML. Used for comment text. */
export function renderMd(text: string): string {
  return marked.parse(text) as string;
}

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  swift: 'swift',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  md: 'markdown',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  lua: 'lua',
  r: 'r',
  R: 'r',
  pl: 'perl',
  pm: 'perl',
  scala: 'scala',
  tf: 'hcl',
  vim: 'vim',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function detectLang(path: string): string | null {
  const basename = path.split('/').pop()!.toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile' || basename === 'gnumakefile') return 'makefile';
  if (basename === 'gemfile' || basename === 'rakefile' || basename.endsWith('.gemspec')) return 'ruby';
  const ext = basename.split('.').pop()!;
  return EXT_TO_LANG[ext] || null;
}

export function highlightLine(code: string, lang: string): string {
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Highlight a sequence of lines as a single block so multi-line tokens
 * (Python docstrings, JS template literals, C-style block comments, ...)
 * carry tokenizer state across line boundaries. Returns one HTML string
 * per input line; spans that cross newlines are closed at end-of-line and
 * re-opened at start-of-next-line so each line stays valid HTML on its own.
 */
export function highlightLines(lines: string[], lang: string): string[] {
  if (!lang || !hljs.getLanguage(lang)) return lines.map(escapeHtml);
  try {
    const joined = lines.join('\n');
    const html = hljs.highlight(joined, { language: lang, ignoreIllegals: true }).value;
    const split = splitHighlightedByLine(html);
    // Defensive: if our splitter produced the wrong line count, fall back rather
    // than mis-aligning content with diff line numbers.
    if (split.length !== lines.length) return lines.map(escapeHtml);
    return split;
  } catch {
    return lines.map(escapeHtml);
  }
}

/**
 * Split hljs HTML on raw newlines while keeping each line's <span> stack
 * balanced. hljs preserves literal '\n' in its output (only the source
 * characters are HTML-escaped), so we walk the string char-by-char, track
 * the open span stack, and on each newline emit `</span>` for every open
 * span, then reopen them on the next line.
 */
function splitHighlightedByLine(html: string): string[] {
  const lines: string[] = [];
  const openSpans: string[] = []; // raw opening tags (e.g. '<span class="hljs-string">')
  let buf = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) {
        buf += html.slice(i);
        break;
      }
      const tag = html.slice(i, end + 1);
      if (tag.startsWith('</span')) openSpans.pop();
      else if (tag.startsWith('<span')) openSpans.push(tag);
      buf += tag;
      i = end + 1;
    } else if (ch === '\n') {
      lines.push(buf + '</span>'.repeat(openSpans.length));
      buf = openSpans.join('');
      i++;
    } else {
      buf += ch;
      i++;
    }
  }
  lines.push(buf);
  return lines;
}

interface DiffLineLike {
  type: 'add' | 'del' | 'context' | 'hunk';
  content: string;
  newLine: number | null;
}

/**
 * Highlight diff lines for display, returning one HTML string per input line
 * (hunk rows → '').
 *
 * New-side lines (`add`/`context`) are highlighted against the full new-file
 * content when `newFileLines` is supplied. This is what keeps multi-line tokens
 * correct: a hunk often begins partway through a `"""` docstring or template
 * literal that opened in an elided region above it. Highlighting the hunk in
 * isolation makes hljs read that first delimiter as an *opening* quote, which
 * inverts string/code coloring for the rest of the hunk. Highlighting the whole
 * file gives hljs the true lexical context, so the delimiter reads correctly.
 *
 * Old-side lines (`del`) are highlighted per-hunk as a block — the base-revision
 * file isn't fetched, so a deletion that opens mid-string is a known minor
 * limitation. `context` lines take the new-side highlight (identical content).
 *
 * Falls back to per-hunk block highlighting for any new-side line when
 * `newFileLines` is absent or its content doesn't match the diff (stale file).
 */
export function highlightDiffLines(
  lines: DiffLineLike[],
  lang: string | null,
  newFileLines: string[] | null,
): string[] {
  const out = new Array<string>(lines.length).fill('');
  if (!lang) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== 'hunk') out[i] = escapeHtml(lines[i].content);
    }
    return out;
  }

  const fileHl = newFileLines ? highlightLines(newFileLines, lang) : null;

  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === 'hunk') {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].type !== 'hunk') j++;

    // Old side (context + del): one per-hunk block.
    const oldIdx: number[] = [];
    const oldText: string[] = [];
    // New side (context + add): one per-hunk block, used as a fallback.
    const newIdx: number[] = [];
    const newText: string[] = [];
    for (let k = i; k < j; k++) {
      const ln = lines[k];
      if (ln.type === 'del' || ln.type === 'context') {
        oldIdx.push(k);
        oldText.push(ln.content);
      }
      if (ln.type === 'add' || ln.type === 'context') {
        newIdx.push(k);
        newText.push(ln.content);
      }
    }
    const oldHtml = highlightLines(oldText, lang);
    for (let m = 0; m < oldIdx.length; m++) out[oldIdx[m]] = oldHtml[m];

    const newBlock = highlightLines(newText, lang);
    for (let m = 0; m < newIdx.length; m++) {
      const ln = lines[newIdx[m]];
      const idx = ln.newLine != null ? ln.newLine - 1 : -1;
      // Use the whole-file highlight only when the file line matches the diff
      // line — a mismatch means the file moved on; fall back rather than show
      // a highlight for the wrong text.
      const fromFile = fileHl && idx >= 0 && newFileLines![idx] === ln.content ? fileHl[idx] : undefined;
      out[newIdx[m]] = fromFile ?? newBlock[m];
    }
    i = j;
  }
  return out;
}

export function showToast(msg: string, duration = 2500): void {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}
