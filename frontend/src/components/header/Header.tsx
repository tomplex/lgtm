import { Show, createSignal, createMemo } from 'solid-js';
import { repoMeta, files, reviewedFiles, userCommentCount, activeItemId, sessionItems, setPaletteOpen } from '../../state';
import LspStatusBadge from './LspStatusBadge';

export type SubmitTarget = 'claude' | 'github';
export type GithubEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

interface Props {
  onRefresh: () => void;
  onSubmit: () => void;
  onSubmitGithub: (event: GithubEvent) => void;
  onToggleCommits: () => void;
  showCommitToggle: boolean;
}

export default function Header(props: Props) {
  const meta = repoMeta;
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  const [submitTarget, setSubmitTarget] = createSignal<SubmitTarget>('claude');
  const [githubEvent, setGithubEvent] = createSignal<GithubEvent>('COMMENT');

  const canSubmitGithub = createMemo(() => !!meta().pr && activeItemId() === 'diff');

  const totalAdd = createMemo(() => files().reduce((s, f) => s + f.additions, 0));
  const totalDel = createMemo(() => files().reduce((s, f) => s + f.deletions, 0));
  const reviewedCount = createMemo(() => files().filter((f) => reviewedFiles[f.path]).length);
  const unreviewed = createMemo(() => files().filter((f) => !reviewedFiles[f.path]));
  const remainingAdd = createMemo(() => unreviewed().reduce((s, f) => s + f.additions, 0));
  const remainingDel = createMemo(() => unreviewed().reduce((s, f) => s + f.deletions, 0));

  function handleSubmitClick() {
    if (submitTarget() === 'github') {
      props.onSubmitGithub(githubEvent());
    } else {
      props.onSubmit();
    }
  }

  const githubLabel = () => {
    const labels: Record<GithubEvent, string> = {
      'COMMENT': 'Comment on GitHub',
      'APPROVE': 'Approve on GitHub',
      'REQUEST_CHANGES': 'Request Changes on GitHub',
    };
    return labels[githubEvent()];
  };

  return (
    <header>
      <div class="header-top">
        <h1>
          <button class="header-project-btn" onClick={() => setPaletteOpen(true)} title="Switch project (Cmd-K)">
            <strong>{meta().repoName || 'Code Review'}</strong>
            <span class="header-project-chevron">&#9662;</span>
          </button>{' '}
          <Show when={meta().branch}>
            <span class="header-branch">
              {meta().branch} → {meta().baseBranch || 'main'}
            </span>
          </Show>
          <Show when={meta().pr}>
            {(pr) => (
              <a class="header-pr" href={pr().url} target="_blank">
                PR #{pr().number}
              </a>
            )}
          </Show>
        </h1>
      </div>
      <div class="header-bottom">
        <div class="stats" id="stats">
          {files().length} file{files().length !== 1 ? 's' : ''} &middot; <span class="add">+{totalAdd()}</span>{' '}
          <span class="del">-{totalDel()}</span>
          <Show when={reviewedCount() === files().length && files().length > 0}> &middot; All files reviewed</Show>
          <Show when={reviewedCount() > 0 && reviewedCount() < files().length}>
            {' '}
            &middot; <span class="add">+{remainingAdd()}</span> <span class="del">-{remainingDel()}</span> to review
          </Show>
          <Show when={userCommentCount() > 0}>
            {' '}
            &middot; {userCommentCount()} comment{userCommentCount() !== 1 ? 's' : ''}
          </Show>
        </div>
        <div class="header-actions">
          <LspStatusBadge />
          <Show when={props.showCommitToggle}>
            <div class="commit-toggle" id="commit-toggle-wrap">
              <button class="header-btn" onClick={props.onToggleCommits}>
                Commits
              </button>
            </div>
          </Show>
          <button class="header-btn" onClick={props.onRefresh}>
            Refresh
          </button>
          <div class="submit-group">
            <button id="submit-btn" onClick={handleSubmitClick}>
              {submitTarget() === 'github' ? githubLabel() : 'Submit Review'}
            </button>
            <button
              class="submit-dropdown-toggle"
              onClick={() => setDropdownOpen(!dropdownOpen())}
              aria-label="Submit options"
            >
              &#9662;
            </button>
            <Show when={dropdownOpen()}>
              <div class="submit-dropdown">
                <button
                  class="submit-dropdown-item"
                  classList={{ active: submitTarget() === 'claude' }}
                  onClick={() => { setSubmitTarget('claude'); setDropdownOpen(false); }}
                >
                  Submit to Claude
                </button>
                <Show when={canSubmitGithub()}>
                  <button
                    class="submit-dropdown-item"
                    classList={{ active: submitTarget() === 'github' }}
                    onClick={() => { setSubmitTarget('github'); setDropdownOpen(false); }}
                  >
                    Submit to GitHub PR
                  </button>
                  <Show when={submitTarget() === 'github'}>
                    <div class="submit-dropdown-divider" />
                    <button
                      class="submit-dropdown-item"
                      classList={{ active: githubEvent() === 'COMMENT' }}
                      onClick={() => { setGithubEvent('COMMENT'); setDropdownOpen(false); }}
                    >
                      Comment
                    </button>
                    <button
                      class="submit-dropdown-item"
                      classList={{ active: githubEvent() === 'APPROVE' }}
                      onClick={() => { setGithubEvent('APPROVE'); setDropdownOpen(false); }}
                    >
                      Approve
                    </button>
                    <button
                      class="submit-dropdown-item"
                      classList={{ active: githubEvent() === 'REQUEST_CHANGES' }}
                      onClick={() => { setGithubEvent('REQUEST_CHANGES'); setDropdownOpen(false); }}
                    >
                      Request Changes
                    </button>
                  </Show>
                </Show>
              </div>
            </Show>
          </div>
          <Show when={activeItemId() !== 'diff'}>
            <div style="font-size:10px;color:var(--text-muted);text-align:right;margin-top:2px">
              {sessionItems().find((i) => i.id === activeItemId())?.title ?? activeItemId()}
            </div>
          </Show>
        </div>
      </div>
    </header>
  );
}
