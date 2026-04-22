import { filterQuery, setFilterQuery } from '../../state';

export default function FileSearch() {
  let inputRef!: HTMLInputElement;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      inputRef.value = '';
      setFilterQuery('');
      inputRef.blur();
    } else if (e.key === 'Enter') {
      inputRef.blur();
    }
  }

  // Expose focus for the `f` keyboard shortcut.
  (window as any).__focusFileSearch = () => inputRef?.focus();

  return (
    <div class="sidebar-search">
      <input
        ref={inputRef}
        type="text"
        id="file-search"
        placeholder="Filter files... (f)"
        autocomplete="off"
        value={filterQuery()}
        onInput={(e) => setFilterQuery(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
