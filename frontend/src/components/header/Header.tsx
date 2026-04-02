import { Show, createMemo } from 'solid-js';
import { repoMeta, files, reviewedFiles, userCommentCount, activeItemId, sessionItems } from '../../state';

interface Props {
  onRefresh: () => void;
  onSubmit: () => void;
  onToggleCommits: () => void;
  showCommitToggle: boolean;
}

export default function Header(props: Props) {
  const meta = repoMeta;

  const totalAdd = createMemo(() => files().reduce((s, f) => s + f.additions, 0));
  const totalDel = createMemo(() => files().reduce((s, f) => s + f.deletions, 0));
  const reviewedCount = createMemo(() => files().filter((f) => reviewedFiles[f.path]).length);
  const remainingLines = createMemo(() =>
    files()
      .filter((f) => !reviewedFiles[f.path])
      .reduce((s, f) => s + f.additions, 0),
  );

  return (
    <header>
      <h1>
        <strong>{meta().repoName || 'Code Review'}</strong>{' '}
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
      <div class="stats" id="stats">
        {files().length} file{files().length !== 1 ? 's' : ''} &middot; <span class="add">+{totalAdd()}</span>{' '}
        <span class="del">-{totalDel()}</span>
        <Show when={reviewedCount() === files().length && files().length > 0}> &middot; All files reviewed</Show>
        <Show when={reviewedCount() < files().length && remainingLines() > 0}>
          {' '}
          &middot; {remainingLines()} line{remainingLines() !== 1 ? 's' : ''} to review
        </Show>
        <Show when={userCommentCount() > 0}>
          {' '}
          &middot; {userCommentCount()} comment{userCommentCount() !== 1 ? 's' : ''}
        </Show>
      </div>
      <div class="header-actions">
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
        <button id="submit-btn" onClick={props.onSubmit}>
          Submit Review
        </button>
        <Show when={activeItemId() !== 'diff'}>
          <div style="font-size:10px;color:var(--text-muted);text-align:right;margin-top:2px">
            {sessionItems().find((i) => i.id === activeItemId())?.title ?? activeItemId()}
          </div>
        </Show>
      </div>
    </header>
  );
}
