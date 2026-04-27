// frontend/src/components/walkthrough/StopArtifact.tsx
import { For, Show } from 'solid-js';
import type { StopArtifact as Artifact } from '../../walkthrough-types';
import { detectLang, escapeHtml } from '../../utils';
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

export function StopArtifact(props: { artifact: Artifact }) {
  const indexed = () => linesForArtifact(props.artifact);
  const lang = () => detectLang(props.artifact.file);
  const wdiffs = () => wordDiffsByIdx(indexed());

  return (
    <div class="wt-artifact">
      <Show when={props.artifact.banner}>
        <div class="wt-banner">{props.artifact.banner}</div>
      </Show>
      <div class="wt-artifact-header">{props.artifact.file}</div>
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
                />
              </Show>
            )}
          </For>
        </table>
      </Show>
    </div>
  );
}
