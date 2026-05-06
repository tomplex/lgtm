export interface Comment {
  id: string;
  author: 'user' | 'claude';
  text: string;
  status: 'active' | 'resolved' | 'dismissed';
  parentId?: string;
  item: string;
  file?: string;
  line?: number;
  side?: 'RIGHT' | 'LEFT';
  block?: number;
  mode?: 'review' | 'direct';
  /** Set when the optimistic save POST failed. Cleared on successful retry. */
  error?: string;
}
