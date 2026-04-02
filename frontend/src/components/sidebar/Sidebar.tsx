import { createSignal } from 'solid-js';
import FileSearch from './FileSearch';
import ViewToggle from './ViewToggle';
import FileList from './FileList';

export default function Sidebar() {
  const [filterQuery, setFilterQuery] = createSignal('');

  return (
    <div class="sidebar">
      <div class="sidebar-controls">
        <ViewToggle />
        <FileSearch onFilter={setFilterQuery} />
      </div>
      <FileList filterQuery={filterQuery()} />
    </div>
  );
}
