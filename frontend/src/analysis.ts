import type { DiffFile, Analysis } from './state';

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  important: 1,
  normal: 2,
  low: 3,
};

interface FileGroup {
  name: string;
  description?: string;
  files: DiffFile[];
}

export function sortFilesByPriority(files: DiffFile[], analysis: Analysis): DiffFile[] {
  return [...files].sort((a, b) => {
    const pa = analysis.files[a.path]?.priority;
    const pb = analysis.files[b.path]?.priority;
    const oa = pa ? PRIORITY_ORDER[pa] : 4;
    const ob = pb ? PRIORITY_ORDER[pb] : 4;
    if (oa !== ob) return oa - ob;
    return files.indexOf(a) - files.indexOf(b);
  });
}

export function groupFiles(files: DiffFile[], analysis: Analysis): FileGroup[] {
  const grouped = new Set<string>();
  const result: FileGroup[] = [];

  for (const group of analysis.groups) {
    const groupFiles = group.files
      .map((path) => files.find((f) => f.path === path))
      .filter((f): f is DiffFile => f != null);
    if (groupFiles.length > 0) {
      result.push({ name: group.name, description: group.description, files: groupFiles });
      for (const f of groupFiles) grouped.add(f.path);
    }
  }

  const ungrouped = files.filter((f) => !grouped.has(f.path));
  if (ungrouped.length > 0) {
    result.push({ name: 'Other', files: ungrouped });
  }

  return result;
}

interface PhasedFiles {
  review: DiffFile[];
  skim: DiffFile[];
  'rubber-stamp': DiffFile[];
}

export function phaseFiles(files: DiffFile[], analysis: Analysis): PhasedFiles {
  const result: PhasedFiles = { review: [], skim: [], 'rubber-stamp': [] };
  for (const file of files) {
    const phase = analysis.files[file.path]?.phase ?? 'skim';
    result[phase].push(file);
  }
  return result;
}
