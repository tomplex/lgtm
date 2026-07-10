export interface Comment {
  id: string;
  author: 'user' | 'claude';
  text: string;
  status: 'active' | 'resolved' | 'dismissed';
  /** How a resolved comment was addressed. Set by the resolve_comments MCP tool. */
  resolution?: string;
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
