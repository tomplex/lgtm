import { createEffect, createSignal, For, Show } from 'solid-js';
import { paletteOpen, setPaletteOpen } from '../../state';
import { fetchRegisteredProjects, deregisterProject, getProjectSlug, type ProjectSummary } from '../../api';
import { filterProjects } from './filter';

export default function ProjectPalette() {
  const [projects, setProjects] = createSignal<ProjectSummary[]>([]);
  const [query, setQuery] = createSignal('');
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [confirming, setConfirming] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;
  let backdropRef: HTMLDivElement | undefined;

  const currentSlug = () => getProjectSlug();
  const matches = () => filterProjects(projects(), query());

  createEffect(() => {
    if (paletteOpen()) {
      setQuery('');
      setSelectedIdx(0);
      setConfirming(null);
      fetchRegisteredProjects().then(setProjects).catch(() => setProjects([]));
      queueMicrotask(() => inputRef?.focus());
    }
  });

  function close() {
    setPaletteOpen(false);
  }

  function activate(p: ProjectSummary) {
    if (p.slug === currentSlug()) { close(); return; }
    if (p.branch === null) return;
    window.location.href = `/project/${encodeURIComponent(p.slug)}/`;
  }

  async function remove(slug: string) {
    await deregisterProject(slug);
    setConfirming(null);
    const fresh = await fetchRegisteredProjects();
    setProjects(fresh);
    if (slug === currentSlug()) {
      window.location.href = '/';
      return;
    }
    setSelectedIdx((i) => Math.min(i, Math.max(0, fresh.length - 1)));
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const rows = matches();
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[selectedIdx()];
      if (row) activate(row);
    }
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === backdropRef) close();
  }

  return (
    <Show when={paletteOpen()}>
      <div class="project-palette-backdrop" ref={backdropRef} onClick={onBackdropClick}>
        <div class="project-palette-dialog" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            type="text"
            class="project-palette-input"
            placeholder="Switch project…"
            value={query()}
            onInput={(e) => { setQuery(e.currentTarget.value); setSelectedIdx(0); }}
          />
          <Show
            when={matches().length > 0}
            fallback={<div class="project-palette-empty">{projects().length === 0 ? 'No projects registered yet.' : 'No matches.'}</div>}
          >
            <div class="project-palette-results">
              <For each={matches()}>
                {(p, i) => (
                  <div
                    class="project-palette-row"
                    classList={{
                      selected: i() === selectedIdx(),
                      current: p.slug === currentSlug(),
                      missing: p.branch === null,
                    }}
                    onMouseEnter={() => setSelectedIdx(i())}
                    onClick={() => activate(p)}
                  >
                    <span class="project-palette-row-name">{p.repoName}</span>
                    <span class="project-palette-row-meta">
                      <Show when={p.branch} fallback={<em>(repo missing)</em>}>
                        {p.branch}
                      </Show>
                      <Show when={p.pr}>
                        {(pr) => <>{' '}<span class="project-palette-row-pr">PR #{pr().number}</span></>}
                      </Show>
                      <Show when={p.slug === currentSlug()}>
                        {' '}<span class="project-palette-row-current">(current)</span>
                      </Show>
                    </span>
                    <span class="project-palette-row-counts">
                      <Show when={p.userCommentCount > 0}>{p.userCommentCount}d </Show>
                      <Show when={p.claudeCommentCount > 0}>{p.claudeCommentCount}c</Show>
                    </span>
                    <span class="project-palette-row-actions">
                      <Show
                        when={confirming() === p.slug}
                        fallback={
                          <button
                            class="project-palette-row-remove"
                            aria-label="Remove project"
                            onClick={(e) => { e.stopPropagation(); setConfirming(p.slug); }}
                          >×</button>
                        }
                      >
                        <button class="project-palette-row-yes" onClick={(e) => { e.stopPropagation(); remove(p.slug); }}>Yes</button>
                        <button class="project-palette-row-no" onClick={(e) => { e.stopPropagation(); setConfirming(null); }}>No</button>
                      </Show>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="project-palette-footer">
            &uarr;&darr; navigate &middot; Enter open &middot; Esc close
          </div>
        </div>
      </div>
    </Show>
  );
}
