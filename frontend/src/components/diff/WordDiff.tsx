import { escapeHtml } from '../../utils';

interface WordPart {
  text: string;
  changed: boolean;
}

export function computeWordDiff(oldStr: string, newStr: string): { oldParts: WordPart[]; newParts: WordPart[] } {
  const oldWords = oldStr.match(/\S+|\s+/g) || [];
  const newWords = newStr.match(/\S+|\s+/g) || [];

  const m = oldWords.length;
  const n = newWords.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldWords[i - 1] === newWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  let i = m;
  let j = n;
  const oldParts: WordPart[] = [];
  const newParts: WordPart[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      oldParts.unshift({ text: oldWords[i - 1], changed: false });
      newParts.unshift({ text: newWords[j - 1], changed: false });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newParts.unshift({ text: newWords[j - 1], changed: true });
      j--;
    } else {
      oldParts.unshift({ text: oldWords[i - 1], changed: true });
      i--;
    }
  }
  return { oldParts, newParts };
}

export function renderWordDiffHtml(parts: WordPart[], cls: string): string {
  return parts
    .map((p) => (p.changed ? `<span class="${cls}">${escapeHtml(p.text)}</span>` : escapeHtml(p.text)))
    .join('');
}
