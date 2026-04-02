import { createResource, For, Show, createMemo } from 'solid-js';
import { files, activeFileIdx, toggleWholeFileView } from '../../state';
import { fetchFile } from '../../api';
import { escapeHtml, detectLang } from '../../utils';
import DiffLine from './DiffLine';
import type { DiffLine as DiffLineType } from '../../state';

export default function WholeFileView() {
  const file = createMemo(() => files()[activeFileIdx()]);
  const lang = createMemo(() => (file() ? detectLang(file()!.path) : null));

  const [wholeFileLines] = createResource(
    () => file()?.path,
    async (path) => {
      if (!path) return [];
      return fetchFile(path);
    },
  );

  const addLines = createMemo(() => {
    const f = file();
    if (!f) return new Set<number>();
    const set = new Set<number>();
    for (const line of f.lines) {
      if (line.type === 'add' && line.newLine) set.add(line.newLine);
    }
    return set;
  });

  const asDiffLines = createMemo((): { line: DiffLineType; lineIdx: number }[] => {
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

  return (
    <Show when={file()}>
      {(f) => (
        <>
          <div class="diff-file-header">
            {escapeHtml(f().path)}{' '}
            <a
              style="float:right;font-size:11px;font-weight:400;color:var(--accent);cursor:pointer"
              onClick={() => toggleWholeFileView()}
            >
              Back to diff
            </a>
          </div>
          <Show when={wholeFileLines()} fallback={<div class="empty-state">Loading...</div>}>
            <table class="diff-table">
              <For each={asDiffLines()}>
                {(item) => <DiffLine line={item.line} lineIdx={item.lineIdx} filePath={f().path} lang={lang()} />}
              </For>
            </table>
          </Show>
        </>
      )}
    </Show>
  );
}
