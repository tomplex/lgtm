import FileSearch from './FileSearch';
import SortGroupControls from './SortGroupControls';
import FileTree from './FileTree';

export default function Sidebar() {
  return (
    <div class="sidebar">
      <div class="sidebar-controls">
        <FileSearch />
        <SortGroupControls />
      </div>
      <FileTree />
    </div>
  );
}
