import FileSearch from './FileSearch';
import ViewToggle from './ViewToggle';
import FileList from './FileList';

export default function Sidebar() {
  // TODO: integrate filter query into FileList's rendering (currently no-op)
  return (
    <div class="sidebar">
      <div class="sidebar-controls">
        <ViewToggle />
        <FileSearch onFilter={() => {}} />
      </div>
      <FileList />
    </div>
  );
}
