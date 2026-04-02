import {
  files,
  activeFileIdx,
  repoMeta,
  allCommits,
  selectedShas,
  setFiles,
  setActiveFileIdx,
  setAllCommits,
} from './state';
import { fetchCommits, fetchItemData } from './api';
import { escapeHtml, showToast } from './utils';
import { parseDiff, renderDiff } from './diff';
import { renderFileList } from './file-list';

export async function loadCommits(): Promise<void> {
  try {
    const commits = await fetchCommits();
    setAllCommits(commits);
    if (commits.length === 0) return;

    document.getElementById('commit-toggle-wrap')!.style.display = '';
    const onBaseBranch = repoMeta.branch === repoMeta.baseBranch;
    if (!onBaseBranch) {
      commits.forEach((c) => selectedShas.add(c.sha));
    }
    updateCommitToggle();
    renderCommitPanel();
  } catch {
    /* ignore */
  }
}

function updateCommitToggle(): void {
  const btn = document.getElementById('commit-toggle-btn')!;
  const total = allCommits.length;
  const selected = selectedShas.size;
  btn.innerHTML = selected === total ? `Commits (${total})` : `Commits (${selected}/${total})`;
}

export function toggleCommitPanel(): void {
  document.getElementById('commit-panel')!.classList.toggle('open');
}

function renderCommitPanel(): void {
  const panel = document.getElementById('commit-panel')!;
  let html = `<div class="commit-actions">
    <a data-action="select-all-commits">Select all</a>
    <a data-action="select-none-commits">Select none</a>
    <a data-action="apply-commits">Apply</a>
  </div>`;
  html += '<div class="commit-list">';
  for (const c of allCommits) {
    const checked = selectedShas.has(c.sha) ? 'checked' : '';
    html += `<label class="commit-item">
      <input type="checkbox" ${checked} data-sha="${c.sha}">
      <span class="commit-sha">${c.sha.slice(0, 7)}</span>
      <span class="commit-msg" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</span>
      <span class="commit-date">${escapeHtml(c.date)}</span>
    </label>`;
  }
  html += '</div>';
  panel.innerHTML = html;

  panel.querySelectorAll<HTMLInputElement>('input[data-sha]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) selectedShas.add(el.dataset.sha!);
      else selectedShas.delete(el.dataset.sha!);
      updateCommitToggle();
    });
  });
  panel.querySelector('[data-action="select-all-commits"]')!.addEventListener('click', () => {
    allCommits.forEach((c) => selectedShas.add(c.sha));
    renderCommitPanel();
    updateCommitToggle();
  });
  panel.querySelector('[data-action="select-none-commits"]')!.addEventListener('click', () => {
    selectedShas.clear();
    renderCommitPanel();
    updateCommitToggle();
  });
  panel.querySelector('[data-action="apply-commits"]')!.addEventListener('click', applyCommitSelection);
}

async function applyCommitSelection(): Promise<void> {
  document.getElementById('commit-panel')!.classList.remove('open');

  const commits =
    selectedShas.size > 0 && selectedShas.size < allCommits.length ? Array.from(selectedShas).join(',') : undefined;

  try {
    const data = await fetchItemData('diff', commits);
    if (data.mode !== 'diff') return;
    setFiles(parseDiff(data.diff));
    if (activeFileIdx >= files.length) setActiveFileIdx(0);
    renderFileList();
    if (files.length > 0) renderDiff(activeFileIdx);
    else
      document.getElementById('diff-container')!.innerHTML =
        '<div class="empty-state">No changes for selected commits</div>';
    showToast(`Showing ${selectedShas.size} commit${selectedShas.size !== 1 ? 's' : ''}`);
  } catch (e: any) {
    showToast('Failed to apply: ' + e.message);
  }
}
