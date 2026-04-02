interface Props {
  onFilter: (query: string) => void;
}

export default function FileSearch(props: Props) {
  let inputRef!: HTMLInputElement;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      inputRef.value = '';
      props.onFilter('');
      inputRef.blur();
    } else if (e.key === 'Enter') {
      inputRef.blur();
    }
  }

  // Expose focus for keyboard shortcut
  (window as any).__focusFileSearch = () => inputRef?.focus();

  return (
    <div class="sidebar-search">
      <input
        ref={inputRef}
        type="text"
        id="file-search"
        placeholder="Filter files... (f)"
        autocomplete="off"
        onInput={(e) => props.onFilter(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
