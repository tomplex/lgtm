export interface Comment {
  id: string;
  author: 'user' | 'claude';
  text: string;
  status: 'active' | 'resolved' | 'dismissed';
  /** ISO timestamp. Absent on comments persisted before timestamps existed. */
  createdAt?: string;
  /** How a resolved comment was addressed. Set by the resolve_comments MCP tool. */
  resolution?: string;
  parentId?: string;
  item: string;
  file?: string;
  line?: number;
  side?: 'RIGHT' | 'LEFT';
  block?: number;
  mode?: 'review' | 'direct';
}

export type CommentFilter = {
  item?: string;
  file?: string;
  author?: 'user' | 'claude';
  parentId?: string;
  mode?: 'review' | 'direct';
  status?: 'active' | 'resolved' | 'dismissed';
};

export type CreateComment = Omit<Comment, 'id' | 'status'>;
