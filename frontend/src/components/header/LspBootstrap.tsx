import { createEffect, createSignal, For, Show } from 'solid-js';
import { lspBootstrapOpen, setLspBootstrapOpen, setLspStatus, type Language } from '../../state';
import {
  fetchBootstrapPlan,
  runBootstrap,
  fetchLspState,
  type BootstrapPlanEntry,
  type InstallResult,
} from '../../api';

type Status = 'idle' | 'installing' | 'done';

export default function LspBootstrap() {
  const [plan, setPlan] = createSignal<BootstrapPlanEntry[] | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<Status>('idle');
  const [results, setResults] = createSignal<Record<string, InstallResult>>({});
  let backdropRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!lspBootstrapOpen()) return;
    setError(null);
    setResults({});
    setStatus('idle');
    setPlan(null);
    fetchBootstrapPlan()
      .then(setPlan)
      .catch((e) => setError(e.message ?? 'Failed to load plan'));
  });

  function close() {
    setLspBootstrapOpen(false);
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === backdropRef) close();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  async function install(languages: Language[]) {
    setStatus('installing');
    setError(null);
    try {
      const out = await runBootstrap(languages);
      const merged = { ...results() };
      for (const r of out) merged[r.language] = r;
      setResults(merged);
      // Refresh both the plan (so installerAvailable / status update) and the global LSP state.
      const [freshPlan, freshState] = await Promise.all([fetchBootstrapPlan(), fetchLspState()]);
      setPlan(freshPlan);
      for (const lang of ['python', 'typescript', 'rust'] as const) {
        const wire = freshState[lang];
        setLspStatus(lang, wire === 'partial' ? 'ok' : wire);
      }
      setStatus('done');
    } catch (e) {
      setError((e as Error).message ?? 'Install failed');
      setStatus('idle');
    }
  }

  function relevantMissing(): BootstrapPlanEntry[] {
    return (plan() ?? []).filter((p) => p.presentInRepo && p.status !== 'ok' && p.installerAvailable);
  }

  return (
    <Show when={lspBootstrapOpen()}>
      <div
        class="project-palette-backdrop"
        ref={backdropRef}
        onClick={onBackdropClick}
        onKeyDown={onKeyDown}
        tabIndex={-1}
      >
        <div class="lsp-bootstrap-dialog">
          <div class="lsp-bootstrap-header">
            <h2>Set up language servers</h2>
            <button class="lsp-bootstrap-close" onClick={close} aria-label="Close">
              ×
            </button>
          </div>

          <Show when={error()}>
            <div class="lsp-bootstrap-error">{error()}</div>
          </Show>

          <Show when={plan()} fallback={<div class="lsp-bootstrap-loading">Loading…</div>}>
            <div class="lsp-bootstrap-rows">
              <For each={plan()!}>
                {(entry) => {
                  const result = () => results()[entry.language];
                  const isInstalling = () => status() === 'installing';
                  const canInstall = () => entry.installerAvailable && entry.status !== 'ok' && !isInstalling();
                  return (
                    <div class="lsp-bootstrap-row" classList={{ dimmed: !entry.presentInRepo }}>
                      <div class="lsp-bootstrap-row-head">
                        <span class="lsp-bootstrap-lang">{entry.language}</span>
                        <span class={`lsp-bootstrap-status lsp-bootstrap-status-${entry.status}`}>{entry.status}</span>
                        <Show when={!entry.presentInRepo}>
                          <span class="lsp-bootstrap-tag">no files in repo</span>
                        </Show>
                        <Show when={!entry.installerAvailable}>
                          <span class="lsp-bootstrap-tag warn">{entry.installer} not on PATH</span>
                        </Show>
                      </div>
                      <code class="lsp-bootstrap-cmd">{entry.installCommand}</code>
                      <div class="lsp-bootstrap-actions">
                        <button
                          class="lsp-bootstrap-install"
                          disabled={!canInstall()}
                          onClick={() => install([entry.language])}
                        >
                          {isInstalling() ? 'Installing…' : entry.status === 'ok' ? 'Installed' : 'Install'}
                        </button>
                      </div>
                      <Show when={result()}>
                        <pre class="lsp-bootstrap-output" classList={{ failed: result()!.ok === false }}>
                          {result()!.ok ? '✓ ' : '✗ '}
                          {result()!.command}
                          {result()!.stdout ? '\n\n' + result()!.stdout : ''}
                          {result()!.stderr ? '\n\n' + result()!.stderr : ''}
                        </pre>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>

            <div class="lsp-bootstrap-footer">
              <Show
                when={relevantMissing().length > 0}
                fallback={
                  <span class="lsp-bootstrap-footer-msg">
                    Nothing to install — relevant servers are already running.
                  </span>
                }
              >
                <button
                  class="lsp-bootstrap-install primary"
                  disabled={status() === 'installing'}
                  onClick={() => install(relevantMissing().map((e) => e.language))}
                >
                  {status() === 'installing' ? 'Installing…' : `Install all (${relevantMissing().length})`}
                </button>
              </Show>
              <button class="lsp-bootstrap-cancel" onClick={close}>
                Close
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
