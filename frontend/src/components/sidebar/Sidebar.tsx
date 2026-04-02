import { createSignal } from 'solid-js';
import FileSearch from './FileSearch';
import ViewToggle from './ViewToggle';
import FileList from './FileList';

export default function Sidebar() {
  const [_filterQuery, setFilterQuery] = createSignal('');

  // File filtering is handled via CSS class toggling on FileList items
  // For now, filter query is passed down and FileList applies it
  // TODO: integrate filter query into FileList's rendering

  return (
    <div class="sidebar">
      <div class="sidebar-controls">
        <ViewToggle />
        <FileSearch onFilter={setFilterQuery} />
      </div>
      <FileList />
    </div>
  );
}
