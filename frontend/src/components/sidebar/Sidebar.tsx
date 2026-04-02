import { createSignal, Show } from 'solid-js';
import { analysis } from '../../state';
import FileSearch from './FileSearch';
import ViewToggle from './ViewToggle';
import FileList from './FileList';

type SidebarTab = 'files' | 'analysis';

export default function Sidebar() {
  const [filterQuery, setFilterQuery] = createSignal('');
  const [tab, setTab] = createSignal<SidebarTab>('files');

  return (
    <div class="sidebar">
      <Show when={analysis()}>
        <div class="sidebar-tabs">
          <button classList={{ active: tab() === 'files' }} onClick={() => setTab('files')}>Files</button>
          <button classList={{ active: tab() === 'analysis' }} onClick={() => setTab('analysis')}>Analysis</button>
        </div>
      </Show>

      <Show when={tab() === 'files'}>
        <div class="sidebar-controls">
          <ViewToggle />
          <FileSearch onFilter={setFilterQuery} />
        </div>
        <FileList filterQuery={filterQuery()} />
      </Show>

      <Show when={tab() === 'analysis' && analysis()}>
        {(a) => (
          <div class="sidebar-analysis">
            <div class="sidebar-analysis-section">
              <div class="sidebar-analysis-label">Overview</div>
              <div class="sidebar-analysis-text">{a().overview}</div>
            </div>
            <div class="sidebar-analysis-section">
              <div class="sidebar-analysis-label">Review Strategy</div>
              <div class="sidebar-analysis-text">{a().reviewStrategy}</div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
