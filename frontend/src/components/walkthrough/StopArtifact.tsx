// frontend/src/components/walkthrough/StopArtifact.tsx
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import type { StopArtifact as Artifact } from '../../walkthrough-types';
import type { DiffLine as DiffLineType } from '../../state';
import { fetchFile } from '../../api';
import { detectLang, escapeHtml, highlightLines } from '../../utils';
import { computeWordDiff, renderWordDiffHtml } from '../diff/WordDiff';
import DiffLine from '../diff/DiffLine';
import { linesForArtifact, type IndexedLine } from './lines-for-artifact';

/** Pre-compute word-level diffs for any del/add pair, keyed by absolute lineIdx. */
function wordDiffsByIdx(lines: IndexedLine[]): Record<number, string> {
  const result: Record<number, string> = {};
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i].line;
    const b = lines[i + 1].line;
    if (a.type === 'del' && b.type === 'add') {
      const wd = computeWordDiff(a.content, b.content);
      result[lines[i].lineIdx] = renderWordDiffHtml(wd.oldParts, 'wdiff-del');
      result[lines[i + 1].lineIdx] = renderWordDiffHtml(wd.newParts, 'wdiff-add');
    }
  }
  return result;
}

/**
 * Highlight each hunk's old side (context + del) and new side (context + add)
 * as a single block so multi-line tokens (docstrings, template literals,
 * block comments) stay correctly colored across line boundaries. Mirrors the
 * pattern used by DiffView; same shape, scoped to one artifact's lines.
 */
function highlightsByIdx(lines: IndexedLine[], lang: string | null): Record<number, string> {
  if (!lang) return {};
  const result: Record<number, string> = {};
  let i = 0;
  while (i < lines.length) {
    if (lines[i].line.type === 'hunk') {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].line.type !== 'hunk') j++;
    const oldIdx: number[] = [];
    const oldText: string[] = [];
    const newIdx: number[] = [];
    const newText: string[] = [];
    for (let k = i; k < j; k++) {
      const { line, lineIdx } = lines[k];
      if (line.type === 'del' || line.type === 'context') {
        oldIdx.push(lineIdx);
        oldText.push(line.content);
      }
      if (line.type === 'add' || line.type === 'context') {
        newIdx.push(lineIdx);
        newText.push(line.content);
      }
    }
    const oldHtml = highlightLines(oldText, lang);
    const newHtml = highlightLines(newText, lang);
    for (let m = 0; m < oldIdx.length; m++) result[oldIdx[m]] = oldHtml[m];
    // Context lines appear on both sides with identical content; new-side wins.
    for (let m = 0; m < newIdx.length; m++) result[newIdx[m]] = newHtml[m];
    i = j;
  }
  return result;
}

export function StopArtifact(props: { artifact: Artifact }) {
  const indexed = () => linesForArtifact(props.artifact);
  const lang = () => detectLang(props.artifact.file);
  const wdiffs = () => wordDiffsByIdx(indexed());
  const highlights = createMemo(() => highlightsByIdx(indexed(), lang()));

  const [expanded, setExpanded] = createSignal(false);

  // Lazily fetch the whole file when expanded. Resource memoizes on path.
  const [wholeFileLines] = createResource(
    () => (expanded() ? props.artifact.file : null),
    async (path) => (path ? fetchFile(path) : []),
  );

  // Set of new-side line numbers that are additions in the artifact's diff —
  // used to colour the matching lines in the whole-file view.
  const addLines = createMemo(() => {
    const set = new Set<number>();
    for (const { line } of indexed()) {
      if (line.type === 'add' && line.newLine != null) set.add(line.newLine);
    }
    return set;
  });

  const wholeAsDiffLines = createMemo((): { line: DiffLineType; lineIdx: number }[] => {
    const lines = wholeFileLines();
    if (!lines) return [];
    return lines.map((l) => ({
      line: {
        type: addLines().has(l.num) ? ('add' as const) : ('context' as const),
        content: l.content,
        oldLine: l.num,
        newLine: l.num,
      },
      lineIdx: l.num,
    }));
  });

  // Highlight the whole file as one block so multi-line tokens carry tokenizer
  // state across lines in the expanded view too.
  const wholeFileHighlights = createMemo<Record<number, string>>(() => {
    const l = lang();
    const items = wholeAsDiffLines();
    if (!l || items.length === 0) return {};
    const html = highlightLines(
      items.map((it) => it.line.content),
      l,
    );
    const map: Record<number, string> = {};
    for (let i = 0; i < items.length; i++) map[items[i].lineIdx] = html[i];
    return map;
  });

  return (
    <div class="wt-artifact">
      <Show when={props.artifact.banner}>
        <div class="wt-banner">{props.artifact.banner}</div>
      </Show>
      <div class="wt-artifact-header">
        <span>{props.artifact.file}</span>
        <a
          class="wt-artifact-toggle"
          onClick={() => setExpanded(!expanded())}
          title={expanded() ? 'Show only the artifact diff' : 'Show the whole file'}
        >
          {expanded() ? 'Back to diff' : 'Show whole file'}
        </a>
      </div>
      <Show
        when={expanded()}
        fallback={
          <Show when={indexed().length > 0}>
            <table class="diff-table">
              <For each={indexed()}>
                {({ line, lineIdx }) => (
                  <Show
                    when={line.type !== 'hunk'}
                    fallback={
                      <tr class="diff-hunk">
                        <td class="line-num" />
                        <td class="line-num" />
                        <td class="line-content">{escapeHtml(line.content)}</td>
                      </tr>
                    }
                  >
                    <DiffLine
                      line={line}
                      lineIdx={lineIdx}
                      filePath={props.artifact.file}
                      lang={lang()}
                      wordDiffHtml={wdiffs()[lineIdx]}
                      highlightedHtml={highlights()[lineIdx]}
                    />
                  </Show>
                )}
              </For>
            </table>
          </Show>
        }
      >
        <Show when={wholeFileLines()} fallback={<div class="empty-state">Loading...</div>}>
          <table class="diff-table">
            <For each={wholeAsDiffLines()}>
              {(item) => (
                <DiffLine
                  line={item.line}
                  lineIdx={item.lineIdx}
                  filePath={props.artifact.file}
                  lang={lang()}
                  highlightedHtml={wholeFileHighlights()[item.lineIdx]}
                />
              )}
            </For>
          </table>
        </Show>
      </Show>
    </div>
  );
}
