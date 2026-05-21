// frontend/src/components/walkthrough/StopArtifact.tsx
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import type { StopArtifact as Artifact } from '../../walkthrough-types';
import type { DiffLine as DiffLineType } from '../../state';
import { fetchFile } from '../../api';
import { detectLang, escapeHtml, highlightLines, highlightDiffLines } from '../../utils';
import { walkthroughCursor } from '../../state';
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

export function StopArtifact(props: { artifact: Artifact; artifactIdx: number }) {
  const indexed = () => linesForArtifact(props.artifact);
  const lang = () => detectLang(props.artifact.file);
  const wdiffs = () => wordDiffsByIdx(indexed());

  // Fetched eagerly: the whole-file content backs both the expanded view and
  // the lexical context the highlighter needs for the artifact's diff lines.
  const [wholeFileLines] = createResource(
    () => props.artifact.file,
    (path) => fetchFile(path),
  );
  const newFileContent = () => wholeFileLines()?.map((l) => l.content) ?? null;

  const highlights = createMemo<Record<number, string>>(() => {
    const items = indexed();
    const hl = highlightDiffLines(
      items.map((x) => x.line),
      lang(),
      newFileContent(),
    );
    const map: Record<number, string> = {};
    for (let i = 0; i < items.length; i++) map[items[i].lineIdx] = hl[i];
    return map;
  });

  // Map each non-hunk row's absolute lineIdx → its index within the artifact's
  // focusable rows. Used to compare against the walkthrough cursor's rowIdx.
  const focusableRowIdxByLineIdx = createMemo<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    let i = 0;
    for (const { line, lineIdx } of indexed()) {
      if (line.type !== 'hunk') map[lineIdx] = i++;
    }
    return map;
  });

  function isFocused(lineIdx: number): boolean {
    const c = walkthroughCursor();
    if (!c) return false;
    if (c.artifactIdx !== props.artifactIdx) return false;
    return c.rowIdx === focusableRowIdxByLineIdx()[lineIdx];
  }

  const [expanded, setExpanded] = createSignal(false);

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
                      focused={isFocused(lineIdx)}
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
