import type { Comment } from './comment-types';
import type { DiffFile } from './state';
import type { SessionItem } from './state';

export function formatDiffComments(comments: Comment[], files: DiffFile[]): string {
  const byFile: Record<string, { lineNum: number | string; lineType: string; lineContent: string; comment: string }[]> =
    {};

  const diffUserComments = comments.filter(
    (c) =>
      c.author === 'user' &&
      c.item === 'diff' &&
      c.file &&
      c.line != null &&
      !c.parentId &&
      c.mode === 'review' &&
      c.status !== 'dismissed',
  );

  for (const c of diffUserComments) {
    const filePath = c.file!;
    if (!byFile[filePath]) byFile[filePath] = [];
    const file = files.find((f) => f.path === filePath);
    const line = file?.lines[c.line!];
    byFile[filePath].push({
      lineNum: line?.newLine ?? line?.oldLine ?? '?',
      lineType: line?.type ?? 'context',
      lineContent: line?.content ?? '',
      comment: c.text,
    });
  }

  let output = '';
  for (const [filePath, fileComments] of Object.entries(byFile)) {
    output += `## ${filePath}\n\n`;
    for (const fc of fileComments.sort((a, b) => Number(a.lineNum) - Number(b.lineNum))) {
      const prefix = fc.lineType === 'add' ? '+' : fc.lineType === 'del' ? '-' : ' ';
      output += `Line ${fc.lineNum}: \`${prefix}${fc.lineContent.trim()}\`\n`;
      output += `> ${fc.comment}\n\n`;
    }
  }
  return output;
}

export function formatClaudeInteractions(comments: Comment[]): string {
  const byFile: Record<string, { lineNum: number | string; comment: string; reply?: string; resolved: boolean }[]> = {};

  const claudeDiffComments = comments.filter(
    (c) => c.author === 'claude' && c.item === 'diff' && c.file != null && !c.parentId,
  );

  for (const cc of claudeDiffComments) {
    const replies = comments.filter((r) => r.parentId === cc.id);
    const reply = replies.find((r) => r.author === 'user');
    const resolved = cc.status === 'resolved';

    if (!reply && !resolved) continue;

    const filePath = cc.file!;
    if (!byFile[filePath]) byFile[filePath] = [];
    byFile[filePath].push({
      lineNum: cc.line ?? '?',
      comment: cc.text,
      reply: reply?.text,
      resolved,
    });
  }

  let output = '';
  for (const [filePath, interactions] of Object.entries(byFile)) {
    output += `## ${filePath}\n\n`;
    for (const c of interactions.sort((a, b) => Number(a.lineNum) - Number(b.lineNum))) {
      output += `**Claude:** ${c.comment}\n`;
      if (c.reply) {
        output += `**Reply:** ${c.reply}\n`;
      } else if (c.resolved) {
        output += `**Status:** Resolved\n`;
      }
      output += '\n';
    }
  }
  return output;
}

export function formatDocComments(
  comments: Comment[],
  items: SessionItem[],
  blockPreviews: Record<string, string>,
): string {
  let output = '';
  for (const item of items) {
    if (item.id === 'diff') continue;

    const docUserComments = comments.filter(
      (c) => c.author === 'user' && c.item === item.id && c.block != null && !c.parentId && c.status !== 'dismissed',
    );

    if (docUserComments.length === 0) continue;
    output += `## ${item.title}\n\n`;

    const sorted = docUserComments.sort((a, b) => (a.block ?? 0) - (b.block ?? 0));
    for (const c of sorted) {
      const key = `${item.id}-${c.block}`;
      const preview = blockPreviews[key] || `Block ${c.block}`;
      output += `**${preview}${preview.length >= 80 ? '...' : ''}**\n`;
      output += `> ${c.text}\n\n`;
    }
  }
  return output;
}

export function formatDocClaudeInteractions(comments: Comment[], items: SessionItem[]): string {
  let output = '';
  for (const item of items) {
    if (item.id === 'diff') continue;
    const itemClaudeComments = comments.filter((c) => c.author === 'claude' && c.item === item.id && !c.parentId);
    const interactions: { block: number; comment: string; reply?: string; resolved: boolean }[] = [];

    for (const cc of itemClaudeComments) {
      const replies = comments.filter((r) => r.parentId === cc.id);
      const reply = replies.find((r) => r.author === 'user');
      const resolved = cc.status === 'resolved';
      if (!reply && !resolved) continue;
      interactions.push({ block: cc.block ?? 0, comment: cc.text, reply: reply?.text, resolved });
    }

    if (interactions.length === 0) continue;
    output += `## ${item.title}\n\n`;
    for (const c of interactions.sort((a, b) => a.block - b.block)) {
      output += `**Claude:** ${c.comment}\n`;
      if (c.reply) output += `**Reply:** ${c.reply}\n`;
      else if (c.resolved) output += `**Status:** Resolved\n`;
      output += '\n';
    }
  }
  return output;
}

export function formatAllComments(
  comments: Comment[],
  files: DiffFile[],
  items: SessionItem[],
  blockPreviews: Record<string, string>,
): string {
  let output = '';

  const diffOutput = formatDiffComments(comments, files);
  if (diffOutput) output += diffOutput;

  const claudeDiffOutput = formatClaudeInteractions(comments);
  if (claudeDiffOutput) output += claudeDiffOutput;

  const docOutput = formatDocComments(comments, items, blockPreviews);
  if (docOutput) output += docOutput;

  const claudeDocOutput = formatDocClaudeInteractions(comments, items);
  if (claudeDocOutput) output += claudeDocOutput;

  return output || 'No comments (LGTM).';
}
