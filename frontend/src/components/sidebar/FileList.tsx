import { For, Show, createMemo, createSignal } from 'solid-js';
import {
  files,
  activeFileIdx,
  setActiveFileIdx,
  setWholeFileView,
  comments,
  reviewedFiles,
  toggleReviewed,
  analysis,
  sidebarView,
} from '../../state';
import type { DiffFile } from '../../state';
import { sortFilesByPriority, groupFiles, phaseFiles } from '../../analysis';

interface FileItemProps {
  file: DiffFile;
  idx: number;
  showDir?: boolean;
  showSummary?: boolean;
  priorityClass?: string;
  extraClass?: string;
}

function FileItem(props: FileItemProps) {
  const isActive = () => activeFileIdx() === props.idx;
  const isReviewed = () => reviewedFiles[props.file.path] ?? false;

  const fileComments = createMemo(() =>
    comments.list.filter((c) => c.file === props.file.path && !c.parentId && c.status !== 'dismissed'),
  );
  const userCount = () => fileComments().filter((c) => c.author === 'user').length;
  const claudeCount = () => fileComments().filter((c) => c.author === 'claude').length;

  const lastSlash = () => props.file.path.lastIndexOf('/');
  const dir = () => (lastSlash() >= 0 ? props.file.path.slice(0, lastSlash() + 1) : '');
  const base = () => (lastSlash() >= 0 ? props.file.path.slice(lastSlash() + 1) : props.file.path);
  const fileSummary = () => (props.showSummary ? analysis()?.files[props.file.path]?.summary : undefined);

  function handleSelect() {
    setActiveFileIdx(props.idx);
    setWholeFileView(false);
    window.location.hash = 'file=' + encodeURIComponent(props.file.path);
  }

  return (
    <div
      class={`file-item${isActive() ? ' active' : ''}${isReviewed() ? ' reviewed' : ''}${props.extraClass ? ' ' + props.extraClass : ''}${props.priorityClass ? ' ' + props.priorityClass : ''}`}
      data-idx={props.idx}
      onClick={handleSelect}
    >
      <span
        class="review-check"
        title="Mark as reviewed (e)"
        onClick={(e) => {
          e.stopPropagation();
          toggleReviewed(props.file.path);
        }}
      >
        {isReviewed() ? '\u2713' : '\u25CB'}
      </span>
      <span class="filename" title={props.file.path}>
        <Show when={props.showDir && dir()}>
          <span class="dir">{dir()}</span>
        </Show>
        <span class="base">{base()}</span>
        <Show when={fileSummary()}>
          <span class="file-summary">{fileSummary()}</span>
        </Show>
      </span>
      <Show when={claudeCount() > 0}>
        <span class="badge claude-badge" title="Claude comments">
          {claudeCount()}
        </span>
      </Show>
      <Show when={userCount() > 0}>
        <span class="badge comments-badge" title="Your comments">
          {userCount()}
        </span>
      </Show>
      <span class="file-stats">
        <span class="add">+{props.file.additions}</span>
        <span class="del">-{props.file.deletions}</span>
      </span>
    </div>
  );
}

// --- Flat view ---

function FlatFileList() {
  const displayFiles = createMemo(() => {
    const a = analysis();
    return a && sidebarView() === 'flat' ? sortFilesByPriority(files(), a) : files();
  });

  return (
    <For each={displayFiles()}>
      {(file) => {
        const idx = () => files().indexOf(file);
        const priority = () => analysis()?.files[file.path]?.priority;
        return (
          <FileItem
            file={file}
            idx={idx()}
            showDir
            showSummary
            priorityClass={priority() ? `priority-${priority()}` : undefined}
          />
        );
      }}
    </For>
  );
}

// --- Grouped view ---

function GroupedFileList() {
  const groups = createMemo(() => {
    const a = analysis();
    return a ? groupFiles(files(), a) : [];
  });

  return (
    <For each={groups()}>
      {(group) => {
        const hasHighPriority = () =>
          group.files.some((f) => {
            const p = analysis()?.files[f.path]?.priority;
            return p === 'critical' || p === 'important';
          });
        const [expanded, setExpanded] = createSignal(hasHighPriority());
        const totalAdd = () => group.files.reduce((s, f) => s + f.additions, 0);
        const totalDel = () => group.files.reduce((s, f) => s + f.deletions, 0);

        return (
          <>
            <div class="group-header" onClick={() => setExpanded(!expanded())}>
              <div class="group-header-left">
                <span class="group-chevron">{expanded() ? '\u25BE' : '\u25B8'}</span>
                <span class="group-name">{group.name}</span>
                <span class="group-count">
                  {group.files.length} file{group.files.length !== 1 ? 's' : ''}
                </span>
                <Show when={group.description}>
                  <span class="group-desc">{group.description}</span>
                </Show>
              </div>
              <div class="group-stats">
                <span class="add">+{totalAdd()}</span>
                <span class="del">-{totalDel()}</span>
              </div>
            </div>
            <Show when={expanded()}>
              <div class="group-files">
                <For each={group.files}>
                  {(file) => {
                    const idx = () => files().indexOf(file);
                    const priority = () => analysis()?.files[file.path]?.priority;
                    return (
                      <FileItem
                        file={file}
                        idx={idx()}
                        extraClass="grouped"
                        priorityClass={priority() ? `priority-${priority()}` : undefined}
                      />
                    );
                  }}
                </For>
              </div>
            </Show>
          </>
        );
      }}
    </For>
  );
}

// --- Phased view ---

const PHASE_CONFIG = {
  review: { label: 'Review carefully', color: '#f85149', icon: '\u2B24' },
  skim: { label: 'Skim', color: '#d29922', icon: '\u25D0' },
  'rubber-stamp': { label: 'Rubber stamp', color: '#8b949e', icon: '\u25CB' },
} as const;

function PhasedFileList() {
  const phases = createMemo(() => {
    const a = analysis();
    return a ? phaseFiles(files(), a) : { review: [], skim: [], 'rubber-stamp': [] };
  });

  return (
    <For each={(['review', 'skim', 'rubber-stamp'] as const).filter((p) => phases()[p].length > 0)}>
      {(phase) => {
        const phaseFiles_ = () => phases()[phase];
        const config = PHASE_CONFIG[phase];
        const reviewedCount = () => phaseFiles_().filter((f) => reviewedFiles[f.path]).length;
        const pct = () => Math.round((reviewedCount() / phaseFiles_().length) * 100);

        return (
          <>
            <div class="phase-header">
              <div class="phase-header-top">
                <span class="phase-label" style={`color: ${config.color}`}>
                  {config.icon} {config.label}
                </span>
                <span class="phase-progress-text">
                  {reviewedCount()} / {phaseFiles_().length} reviewed
                </span>
              </div>
              <div class="phase-progress-bar">
                <div class="phase-progress-fill" style={`width: ${pct()}%; background: ${config.color}`} />
              </div>
            </div>
            <For each={phaseFiles_()}>
              {(file) => {
                const idx = () => files().indexOf(file);
                return <FileItem file={file} idx={idx()} extraClass="phased" />;
              }}
            </For>
          </>
        );
      }}
    </For>
  );
}

// --- Main FileList ---

export default function FileList() {
  return (
    <div class="file-list" id="file-list">
      <Show when={analysis() && sidebarView() === 'grouped'}>
        <GroupedFileList />
      </Show>
      <Show when={analysis() && sidebarView() === 'phased'}>
        <PhasedFileList />
      </Show>
      <Show when={!analysis() || sidebarView() === 'flat'}>
        <FlatFileList />
      </Show>
    </div>
  );
}
