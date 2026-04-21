import type { ProjectSummary } from '../../api';

function subsequenceMatch(haystack: string, needle: string): boolean {
  let cursor = 0;
  for (const ch of needle) {
    const idx = haystack.indexOf(ch, cursor);
    if (idx === -1) return false;
    cursor = idx + 1;
  }
  return true;
}

export function filterProjects(projects: ProjectSummary[], query: string): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  return projects.filter((p) => {
    const fields = [p.repoName, p.slug, p.repoPath, p.description];
    return fields.some((field) => subsequenceMatch(field.toLowerCase(), q));
  });
}
