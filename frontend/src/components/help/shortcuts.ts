// Single source of truth for keyboard shortcuts shown in the help modal.
// Adding a new shortcut here surfaces it in the UI without touching the modal
// component itself. Keep the order grouped by usage frequency within each
// section; the help modal renders sections top-to-bottom.

export interface Shortcut {
  keys: string[]; // each entry is one keycap; multiple keycaps render side-by-side
  desc: string;
}

export interface ShortcutSection {
  title: string;
  shortcuts: Shortcut[];
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['j', 'k'], desc: 'Next / previous row in the sidebar' },
      { keys: ['↓', '↑'], desc: 'Same as j/k' },
      { keys: ['h', 'l'], desc: 'Collapse / expand folder, or move out / into' },
      { keys: ['[', ']'], desc: 'Jump to previous / next folder' },
      { keys: ['o'], desc: 'Toggle the active folder collapsed' },
      { keys: ['n', 'p'], desc: 'Jump to next / previous comment' },
    ],
  },
  {
    title: 'Review',
    shortcuts: [
      { keys: ['e'], desc: 'Toggle current file (or folder) as reviewed' },
      { keys: ['c'], desc: 'Toggle commit picker' },
      { keys: ['w'], desc: 'Toggle whole-file view' },
      { keys: ['r'], desc: 'Refresh diff and comments' },
      { keys: ['f'], desc: 'Focus file search' },
    ],
  },
  {
    title: 'Walkthrough',
    shortcuts: [
      { keys: ['W'], desc: 'Enter walkthrough mode (when a walkthrough is loaded)' },
      { keys: ['Enter'], desc: 'Next stop' },
      { keys: ['Shift', 'Enter'], desc: 'Previous stop' },
      { keys: ['g', '1–9'], desc: 'Jump to stop by number' },
      { keys: ['j', 'k'], desc: 'Move line cursor down / up within the stop' },
      { keys: ['Ctrl', 'd'], desc: 'Half-page down' },
      { keys: ['Ctrl', 'u'], desc: 'Half-page up' },
      { keys: ['g', 'g'], desc: 'First line of stop' },
      { keys: ['G'], desc: 'Last line of stop' },
      { keys: ['c'], desc: 'Comment on focused line' },
      { keys: ['d'], desc: 'Exit walkthrough mode' },
    ],
  },
  {
    title: 'Global',
    shortcuts: [
      { keys: ['Cmd', 'K'], desc: 'Open project palette' },
      { keys: ['Shift', 'Shift'], desc: 'Open symbol search (double-tap)' },
      { keys: ['?'], desc: 'Open this help' },
      { keys: ['Cmd', 'Enter'], desc: 'Save comment' },
      { keys: ['Esc'], desc: 'Cancel comment / close panel / clear search' },
    ],
  },
];
