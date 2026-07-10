import { createSignal, For, Show, createMemo } from 'solid-js';
import { comments, activeItemId, mdMeta, addLocalComment } from '../../state';
import { renderMd } from '../../utils';
import { createComment as apiCreateComment } from '../../comment-api';
import CommentRow from '../comments/CommentRow';
import CommentTextarea from '../comments/CommentTextarea';

// HTML container elements we recurse THROUGH (emitting their block-level
// descendants) so a document splits into the same granular, ordered blocks a
// markdown doc does — instead of one giant root-wrapper block.
const HTML_CONTAINER_TAGS = new Set(['html', 'body', 'main', 'article', 'section', 'header', 'footer', 'nav']);

function collectHtmlBlocks(root: Element | null, out: Element[], carryId?: string): void {
  if (!root) return;
  let pending = carryId;
  for (const child of Array.from(root.children)) {
    if (HTML_CONTAINER_TAGS.has(child.tagName.toLowerCase())) {
      // A container's own id (e.g. <section id="…"> that a TOC link targets) is
      // carried onto the first block emitted from within it, so anchor links
      // still resolve after the container itself is unwrapped.
      collectHtmlBlocks(child, out, child.id || pending);
    } else if (pending && !child.id) {
      const clone = child.cloneNode(true) as Element;
      clone.id = pending;
      out.push(clone);
    } else {
      out.push(child);
    }
    pending = undefined; // only the first block inside a container inherits the id
  }
}

// Confine an HTML doc's own <style> to its rendered blocks, so its :root
// variables can't clobber the review UI's same-named theme variables (that's
// what turned the comment textarea unreadable — the doc redefined --bg) and
// its rules can't reach the comment chrome (.md-comment lives as a sibling of
// .md-block, not inside it).
const DOC_STYLE_SCOPE = '.md-content.html-doc .md-block';

// Page-level box properties on a doc's <body>/:root make no sense re-applied
// per block (e.g. body { padding } would gap every block), so drop them; the
// review column already provides width/spacing. Everything else on those
// root-ish selectors — colors, fonts, and crucially the CSS variables — is
// kept and inherited by the block's content.
const PAGE_BOX_PROPS = new Set([
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
]);

function declarations(style: CSSStyleDeclaration, dropPageBox: boolean): string {
  let out = '';
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    if (dropPageBox && PAGE_BOX_PROPS.has(prop)) continue;
    const priority = style.getPropertyPriority(prop);
    out += `${prop}: ${style.getPropertyValue(prop)}${priority ? ` !${priority}` : ''}; `;
  }
  return out;
}

function serializeScopedRules(rules: CSSRuleList, scope: string): string {
  let out = '';
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      for (const raw of rule.selectorText.split(',')) {
        const s = raw.trim();
        const rootish = s === ':root' || s === 'html' || s === 'body';
        const sel = rootish ? scope : `${scope} ${s}`;
        out += `${sel} { ${declarations(rule.style, rootish)} }\n`;
      }
    } else if (rule instanceof CSSMediaRule) {
      out += `@media ${rule.conditionText} { ${serializeScopedRules(rule.cssRules, scope)} }\n`;
    } else {
      out += `${rule.cssText}\n`; // @keyframes/@font-face etc. aren't selector-scoped
    }
  }
  return out;
}

function scopeCss(cssText: string, scope: string): string {
  // Parse via the CSSOM (a throwaway <style>) rather than by hand; it's
  // same-origin and removed synchronously, so nothing paints unscoped.
  const el = document.createElement('style');
  el.textContent = cssText;
  document.head.appendChild(el);
  const scoped = el.sheet ? serializeScopedRules(el.sheet.cssRules, scope) : cssText;
  el.remove();
  return scoped;
}

export default function DocumentView() {
  const content = createMemo(() => mdMeta().content || '');

  // HTML docs (.html/.htm added via add_document) render as raw HTML instead of
  // being forced through the markdown parser (which truncates <pre> at blank
  // lines). Prefer the server's `markdown` flag; fall back to the filename.
  const isHtmlDoc = createMemo(() => {
    const meta = mdMeta();
    if (typeof meta.markdown === 'boolean') return !meta.markdown;
    const name = (meta.filename || '').toLowerCase();
    return name.endsWith('.html') || name.endsWith('.htm');
  });

  // HTML docs are parsed once as a real document (proper <head>/<body>), reused
  // by both the block walk and the head-style extraction below.
  const parsedHtml = createMemo(() => (isHtmlDoc() ? new DOMParser().parseFromString(content(), 'text/html') : null));

  // The doc's own <head> <style>/<link>, re-applied so an HTML doc keeps its
  // styling even though only its <body> blocks are rendered.
  const headStyles = createMemo(() => {
    const doc = parsedHtml();
    if (!doc) return '';
    return Array.from(doc.head?.querySelectorAll('style, link[rel="stylesheet"]') ?? [])
      .map(
        (el) =>
          el.tagName.toLowerCase() === 'style'
            ? `<style>${scopeCss(el.textContent ?? '', DOC_STYLE_SCOPE)}</style>`
            : el.outerHTML, // external stylesheet — left as-is (rare in a self-contained spec)
      )
      .join('\n');
  });

  // Ordered list of commentable blocks. Markdown is rendered then split by
  // top-level element (lists split so each <li> is its own block, preserving
  // ordered-list numbering). HTML is split by walking block-level descendants
  // of <body>, so it yields the same granular blocks rather than one wrapper.
  const blocks = createMemo(() => {
    const result: { html: string; idx: number }[] = [];
    let idx = 0;
    const doc = parsedHtml();
    if (doc) {
      const els: Element[] = [];
      collectHtmlBlocks(doc.body, els);
      for (const el of els) result.push({ html: el.outerHTML, idx: idx++ });
      return result;
    }
    const temp = document.createElement('div');
    temp.innerHTML = renderMd(content());
    for (const child of Array.from(temp.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(child.children).filter((c) => c.tagName.toLowerCase() === 'li');
        const startAttr = tag === 'ol' ? parseInt(child.getAttribute('start') || '1', 10) : 1;
        for (let i = 0; i < items.length; i++) {
          const wrapper = document.createElement(tag);
          wrapper.classList.add('md-list-split');
          if (tag === 'ol') wrapper.setAttribute('start', String(startAttr + i));
          wrapper.appendChild(items[i].cloneNode(true));
          result.push({ html: wrapper.outerHTML, idx: idx++ });
        }
      } else {
        result.push({ html: child.outerHTML, idx: idx++ });
      }
    }
    return result;
  });

  const totalComments = createMemo(
    () => comments.list.filter((c) => c.item === activeItemId() && !c.parentId && c.status !== 'dismissed').length,
  );

  return (
    <div class="md-content" classList={{ 'html-doc': isHtmlDoc() }}>
      <div id="stats">
        {mdMeta().filename || 'Document'}
        <Show when={totalComments() > 0}>
          {' '}
          &middot; {totalComments()} comment{totalComments() !== 1 ? 's' : ''}
        </Show>
      </div>
      <Show when={isHtmlDoc() && headStyles()}>
        <div style="display:none" innerHTML={headStyles()} />
      </Show>
      <For each={blocks()}>
        {(block) => <DocumentBlock html={block.html} blockIdx={block.idx} isHtml={isHtmlDoc()} />}
      </For>
    </div>
  );
}

function DocumentBlock(props: { html: string; blockIdx: number; isHtml: boolean }) {
  const [showNewComment, setShowNewComment] = createSignal(false);

  const blockComments = createMemo(() =>
    comments.list.filter(
      (c) => c.item === activeItemId() && c.block === props.blockIdx && !c.parentId && c.status !== 'dismissed',
    ),
  );

  function handleBlockClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.comment-box') || target.closest('.reply-textarea-wrap')) return;

    // HTML docs: plain-click-to-comment like markdown, but a plain click that
    // lands on a genuinely interactive target (a link, a <details> summary)
    // does its native thing instead — commenting on those is rare. Shift+click
    // force-comments even there (and we suppress the native action then).
    if (props.isHtml) {
      if (e.shiftKey) {
        e.preventDefault();
      } else if (target.closest('a[href], summary, button')) {
        return;
      }
    }

    // If user already has a comment, don't open a new one
    const existingUser = blockComments().find((c) => c.author === 'user' && c.mode === 'review');
    if (existingUser) return;

    setShowNewComment(true);
  }

  async function handleSave(text: string) {
    const comment = await apiCreateComment({
      author: 'user',
      text,
      item: activeItemId(),
      block: props.blockIdx,
      mode: 'review',
    });
    addLocalComment(comment);
    setShowNewComment(false);
  }

  return (
    <>
      <div
        class="md-block"
        classList={{ 'has-comment': blockComments().length > 0 }}
        id={`md-block-${activeItemId()}-${props.blockIdx}`}
        data-block={props.blockIdx}
        onClick={handleBlockClick}
        innerHTML={props.html}
      />
      <For each={blockComments()}>
        {(comment) => (
          <div class="md-comment" style="margin:4px 0">
            <div class="comment-box" style="max-width:100%">
              <CommentRow comment={comment} />
            </div>
          </div>
        )}
      </For>
      <Show when={showNewComment()}>
        <div class="md-comment">
          <CommentTextarea onSave={handleSave} onCancel={() => setShowNewComment(false)} />
        </div>
      </Show>
    </>
  );
}
