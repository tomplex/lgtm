import {
  files,
  activeFileIdx,
  comments,
  claudeComments,
  reviewedFiles,
  analysis,
  sidebarView,
  setSidebarView,
} from './state';
import type { SidebarView } from './state';
import { escapeHtml } from './utils';
import { selectFile } from './diff';
import { sortFilesByPriority, groupFiles, phaseFiles } from './analysis';
import { saveState } from './persistence';

// --- File item helper ---

interface FileItemOptions {
  showDir?: boolean;
  showSummary?: boolean;
  priorityClass?: string;
  extraClass?: string;
}

function renderFileItem(file: { path: string; additions: number; deletions: number }, idx: number, opts: FileItemOptions = {}): HTMLDivElement {
  const div = document.createElement('div');
  const isReviewed = reviewedFiles.has(file.path);
  let cls = 'file-item' + (idx === activeFileIdx ? ' active' : '') + (isReviewed ? ' reviewed' : '');
  if (opts.extraClass) cls += ' ' + opts.extraClass;
  if (opts.priorityClass) cls += ' ' + opts.priorityClass;
  div.className = cls;
  div.dataset.idx = String(idx);

  const commentCount = Object.keys(comments).filter((k) => k.startsWith(file.path + '::')).length;
  const claudeCount = claudeComments.filter((c) => c.file === file.path).length;

  const lastSlash = file.path.lastIndexOf('/');
  const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : '';
  const base = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;
  const fileSummary = opts.showSummary ? analysis?.files[file.path]?.summary : undefined;

  div.innerHTML = `
    <span class="review-check" title="Mark as reviewed (e)">${isReviewed ? '&#10003;' : '&#9675;'}</span>
    <span class="filename" title="${escapeHtml(file.path)}">
      ${opts.showDir && dir ? `<span class="dir">${escapeHtml(dir)}</span>` : ''}
      <span class="base">${escapeHtml(base)}</span>
      ${fileSummary ? `<span class="file-summary">${escapeHtml(fileSummary)}</span>` : ''}
    </span>
    ${claudeCount > 0 ? `<span class="badge claude-badge" title="Claude comments">${claudeCount}</span>` : ''}
    ${commentCount > 0 ? `<span class="badge comments-badge" title="Your comments">${commentCount}</span>` : ''}
    <span class="file-stats">
      <span class="add">+${file.additions}</span>
      <span class="del">-${file.deletions}</span>
    </span>
  `;
  div.querySelector('.review-check')!.addEventListener('click', (ev) => { ev.stopPropagation(); toggleReviewed(file.path, ev); });
  div.onclick = () => selectFile(idx);
  return div;
}

// --- File list rendering ---

export function renderFileList(): void {
  if (analysis && sidebarView === 'grouped') {
    renderGroupedFileList();
    return;
  }
  if (analysis && sidebarView === 'phased') {
    renderPhasedFileList();
    return;
  }

  saveState();
  const el = document.getElementById('file-list')!;
  el.innerHTML = '';
  let totalAdd = 0,
    totalDel = 0;

  const displayFiles = analysis && sidebarView === 'flat'
    ? sortFilesByPriority(files, analysis)
    : files;

  displayFiles.forEach((file) => {
    const idx = files.indexOf(file);
    totalAdd += file.additions;
    totalDel += file.deletions;

    const priority = analysis?.files[file.path]?.priority;
    const div = renderFileItem(file, idx, {
      showDir: true,
      showSummary: true,
      priorityClass: priority ? `priority-${priority}` : undefined,
    });
    el.appendChild(div);
  });

  const reviewedCount = displayFiles.filter(f => reviewedFiles.has(f.path)).length;
  const remainingLines = displayFiles.filter(f => !reviewedFiles.has(f.path)).reduce((sum, f) => sum + f.additions, 0);
  const commentCount = Object.keys(comments).filter(k => !k.startsWith('claude:')).length;

  let statsHtml = `${files.length} file${files.length !== 1 ? 's' : ''} &middot; <span class="add">+${totalAdd}</span> <span class="del">-${totalDel}</span>`;
  if (reviewedCount === files.length && files.length > 0) {
    statsHtml += ` &middot; All files reviewed`;
  } else if (remainingLines > 0) {
    statsHtml += ` &middot; ${remainingLines} line${remainingLines !== 1 ? 's' : ''} to review`;
  }
  if (commentCount > 0) {
    statsHtml += ` &middot; ${commentCount} comment${commentCount !== 1 ? 's' : ''}`;
  }
  document.getElementById('stats')!.innerHTML = statsHtml;

  const q = (document.getElementById('file-search') as HTMLInputElement).value;
  if (q) filterFiles(q);
}

function renderGroupedFileList(): void {
  const el = document.getElementById('file-list')!;
  el.innerHTML = '';

  if (!analysis) return;
  const groups = groupFiles(files, analysis);

  for (const group of groups) {
    const hasHighPriority = group.files.some(f => {
      const p = analysis!.files[f.path]?.priority;
      return p === 'critical' || p === 'important';
    });

    const header = document.createElement('div');
    header.className = 'group-header';
    header.dataset.expanded = String(hasHighPriority);

    const totalAdd = group.files.reduce((s, f) => s + f.additions, 0);
    const totalDel = group.files.reduce((s, f) => s + f.deletions, 0);

    header.innerHTML = `
      <div class="group-header-left">
        <span class="group-chevron">${hasHighPriority ? '▾' : '▸'}</span>
        <span class="group-name">${escapeHtml(group.name)}</span>
        <span class="group-count">${group.files.length} file${group.files.length !== 1 ? 's' : ''}</span>
        ${group.description ? `<span class="group-desc">${escapeHtml(group.description)}</span>` : ''}
      </div>
      <div class="group-stats">
        <span class="add">+${totalAdd}</span>
        <span class="del">-${totalDel}</span>
      </div>
    `;

    const fileContainer = document.createElement('div');
    fileContainer.className = 'group-files';
    fileContainer.style.display = hasHighPriority ? '' : 'none';

    for (const file of group.files) {
      const idx = files.indexOf(file);
      const priority = analysis!.files[file.path]?.priority;
      const div = renderFileItem(file, idx, {
        extraClass: 'grouped',
        priorityClass: priority ? `priority-${priority}` : undefined,
      });
      fileContainer.appendChild(div);
    }

    header.addEventListener('click', () => {
      const expanded = header.dataset.expanded === 'true';
      header.dataset.expanded = String(!expanded);
      header.querySelector('.group-chevron')!.textContent = expanded ? '▸' : '▾';
      fileContainer.style.display = expanded ? 'none' : '';
    });

    el.appendChild(header);
    el.appendChild(fileContainer);
  }
}

const PHASE_CONFIG = {
  review: { label: 'Review carefully', color: '#f85149', icon: '⬤' },
  skim: { label: 'Skim', color: '#d29922', icon: '◐' },
  'rubber-stamp': { label: 'Rubber stamp', color: '#8b949e', icon: '○' },
} as const;

function renderPhasedFileList(): void {
  const el = document.getElementById('file-list')!;
  el.innerHTML = '';

  if (!analysis) return;
  const phases = phaseFiles(files, analysis);

  for (const phase of ['review', 'skim', 'rubber-stamp'] as const) {
    const phaseFiles_ = phases[phase];
    if (phaseFiles_.length === 0) continue;

    const config = PHASE_CONFIG[phase];
    const reviewedCount = phaseFiles_.filter(f => reviewedFiles.has(f.path)).length;
    const pct = Math.round((reviewedCount / phaseFiles_.length) * 100);

    const header = document.createElement('div');
    header.className = 'phase-header';
    header.innerHTML = `
      <div class="phase-header-top">
        <span class="phase-label" style="color: ${config.color}">${config.icon} ${config.label}</span>
        <span class="phase-progress-text">${reviewedCount} / ${phaseFiles_.length} reviewed</span>
      </div>
      <div class="phase-progress-bar">
        <div class="phase-progress-fill" style="width: ${pct}%; background: ${config.color}"></div>
      </div>
    `;
    el.appendChild(header);

    for (const file of phaseFiles_) {
      const idx = files.indexOf(file);
      const div = renderFileItem(file, idx, { extraClass: 'phased' });
      el.appendChild(div);
    }
  }
}

// --- View toggle ---

export function renderViewToggle(): void {
  const toggle = document.getElementById('view-toggle')!;
  if (!analysis) {
    toggle.style.display = 'none';
    return;
  }
  toggle.style.display = '';
  toggle.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.view === sidebarView);
  });
}

export function setupViewToggle(): void {
  document.getElementById('view-toggle')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.view-btn');
    if (btn?.dataset.view) {
      setSidebarView(btn.dataset.view as SidebarView);
      renderFileList();
      renderViewToggle();
    }
  });
}

// --- Helpers ---

function toggleReviewed(path: string, e?: Event): void {
  if (e) e.stopPropagation();
  if (reviewedFiles.has(path)) reviewedFiles.delete(path);
  else reviewedFiles.add(path);
  saveState();
  renderFileList();
}

function matchesGlob(path: string, pattern: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
  const basename = path.split('/').pop() || path;
  return regex.test(path) || regex.test(basename);
}

export function filterFiles(query: string): void {
  const q = query.trim().toLowerCase();
  if (!q) {
    document.querySelectorAll<HTMLElement>('.file-item').forEach((el) => el.classList.remove('hidden'));
    return;
  }

  const terms = q.split(/\s+/);
  document.querySelectorAll<HTMLElement>('.file-item').forEach((el) => {
    const path = el.querySelector('.filename')!.textContent!.trim().toLowerCase();
    const visible = terms.every((term) => {
      if (term.startsWith('!')) {
        const neg = term.slice(1);
        if (!neg) return true;
        return neg.includes('*') ? !matchesGlob(path, neg) : !path.includes(neg);
      }
      return term.includes('*') ? matchesGlob(path, term) : path.includes(term);
    });
    el.classList.toggle('hidden', !visible);
  });
}

export function setupFileSearch(): void {
  const input = document.getElementById('file-search') as HTMLInputElement;
  input.addEventListener('input', () => filterFiles(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      filterFiles('');
      input.blur();
    } else if (e.key === 'Enter') {
      const first = document.querySelector<HTMLElement>('.file-item:not(.hidden)');
      if (first) selectFile(parseInt(first.dataset.idx!));
      input.blur();
    }
  });
}
