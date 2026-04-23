import type { Walkthrough, Stop, StopArtifact, HunkRef } from './walkthrough-types.js';

const VALID_IMPORTANCE = new Set(['primary', 'supporting', 'minor']);

/** Parses "12-20" → {newStart:12, newLines:9}. Count is inclusive end − start + 1. */
function parseHunkRange(s: string): HunkRef {
  const m = s.trim().match(/^(\d+)-(\d+)$/);
  if (!m) throw new Error(`Invalid hunk range "${s}"; expected "start-end"`);
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (end < start) throw new Error(`Invalid hunk range "${s}"; end < start`);
  return { newStart: start, newLines: end - start + 1 };
}

export function parseWalkthrough(input: string): Walkthrough {
  // Split on top-level "## " headers.
  const sections = input.split(/^## /m).slice(1);
  if (sections.length === 0) throw new Error('Missing ## Summary section');

  let summary = '';
  const stopSections: string[] = [];

  for (const section of sections) {
    const nl = section.indexOf('\n');
    const heading = section.slice(0, nl).trim();
    const body = section.slice(nl + 1).trim();
    if (heading.toLowerCase() === 'summary') {
      summary = body.split('\n\n')[0].trim();
    } else if (/^stop\s+\d+$/i.test(heading)) {
      stopSections.push(section);
    }
  }

  if (!summary) throw new Error('Missing ## Summary section or empty summary');
  if (stopSections.length === 0) throw new Error('Expected at least one ## Stop N section');

  const stops: Stop[] = stopSections.map((section, i) => {
    const nl = section.indexOf('\n');
    const heading = section.slice(0, nl).trim();
    const body = section.slice(nl + 1);

    const orderMatch = heading.match(/^stop\s+(\d+)$/i);
    const order = orderMatch ? parseInt(orderMatch[1], 10) : i + 1;

    // Split stop body into "metadata + narrative" and "### Artifact" sections.
    const parts = body.split(/^### Artifact:/m);
    const preArtifacts = parts[0];
    const artifactSections = parts.slice(1);

    let importance = '';
    let title = '';
    const narrativeLines: string[] = [];
    let pastMetadata = false;
    for (const line of preArtifacts.split('\n')) {
      const trimmed = line.trim();
      if (!pastMetadata && trimmed.startsWith('- importance:')) {
        importance = trimmed.replace('- importance:', '').trim();
      } else if (!pastMetadata && trimmed.startsWith('- title:')) {
        title = trimmed.replace('- title:', '').trim();
      } else if (!pastMetadata && trimmed === '') {
        if (importance && title) pastMetadata = true;
      } else if (pastMetadata && trimmed !== '') {
        narrativeLines.push(trimmed);
      }
    }

    if (!VALID_IMPORTANCE.has(importance)) {
      throw new Error(`Invalid importance "${importance}" in Stop ${order}`);
    }
    if (!title) throw new Error(`Missing title for Stop ${order}`);
    const narrative = narrativeLines.join(' ').trim();
    if (!narrative) throw new Error(`Missing narrative for Stop ${order}`);

    const artifacts: StopArtifact[] = artifactSections.map((raw) => {
      const aNl = raw.indexOf('\n');
      const file = raw.slice(0, aNl).trim();
      if (!file) throw new Error(`Missing file path for artifact in Stop ${order}`);
      const aBody = raw.slice(aNl + 1);

      const hunks: HunkRef[] = [];
      let banner: string | undefined;
      for (const line of aBody.split('\n')) {
        const t = line.trim();
        if (t.startsWith('- hunk:')) {
          hunks.push(parseHunkRange(t.replace('- hunk:', '')));
        } else if (t.startsWith('- banner:')) {
          banner = t.replace('- banner:', '').trim();
        }
      }
      if (hunks.length === 0) throw new Error(`Artifact "${file}" in Stop ${order} has no hunks`);
      const artifact: StopArtifact = { file, hunks };
      if (banner) artifact.banner = banner;
      return artifact;
    });

    if (artifacts.length === 0) throw new Error(`Stop ${order} has no artifacts`);

    return {
      id: `stop-${order}`,
      order,
      title,
      narrative,
      importance: importance as Stop['importance'],
      artifacts,
    };
  });

  return {
    summary,
    stops,
    // diffHash + generatedAt filled in by the MCP tool, not the parser
    diffHash: '',
    generatedAt: '',
  };
}
