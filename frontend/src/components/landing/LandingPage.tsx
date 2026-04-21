import { createResource, createSignal, For, Show } from 'solid-js';
import { fetchRegisteredProjects, deregisterProject, type ProjectSummary } from '../../api';

export default function LandingPage() {
  const [projects, { refetch }] = createResource(fetchRegisteredProjects);
  const [confirming, setConfirming] = createSignal<string | null>(null);

  function open(slug: string) {
    window.location.href = `/project/${encodeURIComponent(slug)}/`;
  }

  async function remove(slug: string) {
    await deregisterProject(slug);
    setConfirming(null);
    refetch();
  }

  return (
    <div class="landing">
      <div class="landing-header">
        <h1>LGTM</h1>
        <div class="landing-subtitle">Registered projects</div>
      </div>
      <Show when={projects()} fallback={<div class="landing-empty">Loading…</div>}>
        {(list) => (
          <Show
            when={list().length > 0}
            fallback={
              <div class="landing-empty">
                No projects registered yet. Run the MCP <code>start</code> tool from a project to register it.
              </div>
            }
          >
            <div class="landing-grid">
              <For each={list()}>
                {(p) => <ProjectCard
                  project={p}
                  confirming={confirming() === p.slug}
                  onOpen={() => open(p.slug)}
                  onRequestRemove={() => setConfirming(p.slug)}
                  onCancelRemove={() => setConfirming(null)}
                  onConfirmRemove={() => remove(p.slug)}
                />}
              </For>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}

interface CardProps {
  project: ProjectSummary;
  confirming: boolean;
  onOpen: () => void;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}

function ProjectCard(props: CardProps) {
  const p = () => props.project;
  const missing = () => p().branch === null;

  return (
    <div class="landing-card" classList={{ missing: missing() }}>
      <div
        class="landing-card-body"
        onClick={() => { if (!missing()) props.onOpen(); }}
        role={missing() ? undefined : 'button'}
        tabindex={missing() ? undefined : 0}
        onKeyDown={(e) => {
          if (missing()) return;
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onOpen();
          }
        }}
      >
        <div class="landing-card-title">{p().repoName}</div>
        <div class="landing-card-branch">
          <Show when={missing()} fallback={<>{p().branch} → {p().baseBranch}</>}>
            <em>(repo missing)</em>
          </Show>
          <Show when={p().pr}>
            {(pr) => <a class="landing-card-pr" href={pr().url} target="_blank" onClick={(e) => e.stopPropagation()}>PR #{pr().number}</a>}
          </Show>
        </div>
        <div class="landing-card-counts">
          <span classList={{ 'count-muted': p().userCommentCount === 0 }}>{p().userCommentCount} drafted</span>
          {' · '}
          <span classList={{ 'count-muted': p().claudeCommentCount === 0 }}>{p().claudeCommentCount} from Claude</span>
        </div>
        <Show when={p().description}>
          <div class="landing-card-description">{p().description}</div>
        </Show>
        <div class="landing-card-path">{p().repoPath}</div>
      </div>
      <div class="landing-card-actions">
        <Show
          when={props.confirming}
          fallback={
            <button
              class="landing-card-remove"
              aria-label="Remove project"
              onClick={(e) => { e.stopPropagation(); props.onRequestRemove(); }}
            >×</button>
          }
        >
          <span class="landing-card-confirm-text">Remove?</span>
          <button
            class="landing-card-confirm-yes"
            onClick={(e) => { e.stopPropagation(); props.onConfirmRemove(); }}
          >Yes</button>
          <button
            class="landing-card-confirm-no"
            onClick={(e) => { e.stopPropagation(); props.onCancelRemove(); }}
          >No</button>
        </Show>
      </div>
    </div>
  );
}
