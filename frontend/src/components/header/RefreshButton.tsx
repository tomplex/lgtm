import { Show, createMemo } from 'solid-js';
import { connectionState, analysisFreshness } from '../../state';
import { postRefreshAnalysis } from '../../refresh-api';
import { getProjectSlug } from '../../api';

export default function RefreshButton() {
  const staleCount = createMemo(() => {
    const f = analysisFreshness();
    if (!f) return 0;
    return f.staleFiles.length + f.missingFiles.length + f.removedFiles.length;
  });
  const enabled = createMemo(() => connectionState().alive && staleCount() > 0);

  function copyFallbackPrompt() {
    const slug = getProjectSlug();
    const text = `Run \`/lgtm refresh\` for project \`${slug}\``;
    navigator.clipboard?.writeText(text).catch(() => {
      /* clipboard may be unavailable */
    });
  }

  async function onClick() {
    if (enabled()) {
      try {
        const res = await postRefreshAnalysis();
        if (!res.delivered) copyFallbackPrompt();
      } catch {
        copyFallbackPrompt();
      }
    } else {
      copyFallbackPrompt();
    }
  }

  return (
    <Show when={analysisFreshness()}>
      <button
        class="refresh-button"
        classList={{ active: enabled(), disabled: !enabled() }}
        onClick={onClick}
        title={
          enabled()
            ? 'Send refresh request to Claude'
            : staleCount() === 0
              ? 'Analysis is fresh'
              : 'No live Claude session — click to copy prompt'
        }
      >
        Refresh ({staleCount()} stale)
      </button>
    </Show>
  );
}
