const VALID_IMPORTANCE = new Set(['primary', 'supporting', 'minor']);
/** Parses "12-20" → {newStart:12, newLines:9}. Count is inclusive end − start + 1. */
function parseHunkRange(s) {
    const m = s.trim().match(/^(\d+)-(\d+)$/);
    if (!m)
        throw new Error(`Invalid hunk range "${s}"; expected "start-end"`);
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    if (end < start)
        throw new Error(`Invalid hunk range "${s}"; end < start`);
    return { newStart: start, newLines: end - start + 1 };
}
export function parseWalkthrough(input) {
    // Split on top-level "## " headers.
    const sections = input.split(/^## /m).slice(1);
    if (sections.length === 0)
        throw new Error('Missing ## Summary section');
    let summary = '';
    const stopSections = [];
    for (const section of sections) {
        const nl = section.indexOf('\n');
        const heading = section.slice(0, nl).trim();
        const body = section.slice(nl + 1).trim();
        if (heading.toLowerCase() === 'summary') {
            summary = body.split('\n\n')[0].trim();
        }
        else if (/^stop\s+\d+\b/i.test(heading)) {
            stopSections.push(section);
        }
    }
    if (!summary)
        throw new Error('Missing ## Summary section or empty summary');
    if (stopSections.length === 0)
        throw new Error('Expected at least one ## Stop N section');
    const stops = stopSections.map((section, i) => {
        const nl = section.indexOf('\n');
        const heading = section.slice(0, nl).trim();
        const body = section.slice(nl + 1);
        // Heading may be just "Stop 1" or "Stop 1 — Title" / "Stop 1: Title" / "Stop 1 - Title".
        // If a title suffix is present, extract it as a fallback when `- title:` metadata is missing.
        const orderMatch = heading.match(/^stop\s+(\d+)\b(.*)$/i);
        const order = orderMatch ? parseInt(orderMatch[1], 10) : i + 1;
        const headingSuffix = orderMatch ? orderMatch[2].trim().replace(/^[—–\-:.\s]+/, '').trim() : '';
        // Split stop body into "metadata + narrative" and "### Artifact" sections.
        const parts = body.split(/^### Artifact:/m);
        const preArtifacts = parts[0];
        const artifactSections = parts.slice(1);
        let importance = '';
        let title = '';
        const narrativeLines = [];
        let pastMetadata = false;
        for (const line of preArtifacts.split('\n')) {
            const trimmed = line.trim();
            if (!pastMetadata && trimmed.startsWith('- importance:')) {
                importance = trimmed.replace('- importance:', '').trim();
            }
            else if (!pastMetadata && trimmed.startsWith('- title:')) {
                title = trimmed.replace('- title:', '').trim();
            }
            else if (!pastMetadata && trimmed === '') {
                if (importance)
                    pastMetadata = true;
            }
            else if (pastMetadata && trimmed !== '') {
                narrativeLines.push(trimmed);
            }
        }
        // Fall back to the heading suffix when no explicit `- title:` metadata.
        if (!title && headingSuffix)
            title = headingSuffix;
        if (!VALID_IMPORTANCE.has(importance)) {
            throw new Error(`Stop ${order}: invalid importance "${importance}". Must be one of: primary, supporting, minor. ` +
                `Expected a line like "- importance: primary" right under the "## Stop ${order}" heading.`);
        }
        if (!title) {
            throw new Error(`Stop ${order}: missing title. Expected a line like "- title: Short title" right under the ` +
                `"## Stop ${order}" heading (or a title suffix in the heading itself, like "## Stop ${order} — Title").`);
        }
        const narrative = narrativeLines.join(' ').trim();
        if (!narrative) {
            throw new Error(`Stop ${order}: missing narrative paragraph. Expected non-empty prose after the metadata block and before the first "### Artifact:" section.`);
        }
        const artifacts = artifactSections.map((raw) => {
            const aNl = raw.indexOf('\n');
            const file = raw.slice(0, aNl).trim();
            if (!file) {
                throw new Error(`Stop ${order}: artifact heading is missing its file path. Expected "### Artifact: path/to/file.ts".`);
            }
            const aBody = raw.slice(aNl + 1);
            const hunks = [];
            let banner;
            for (const line of aBody.split('\n')) {
                const t = line.trim();
                if (t.startsWith('- hunk:')) {
                    hunks.push(parseHunkRange(t.replace('- hunk:', '')));
                }
                else if (t.startsWith('- banner:')) {
                    banner = t.replace('- banner:', '').trim();
                }
            }
            if (hunks.length === 0) {
                throw new Error(`Stop ${order}, artifact "${file}": no hunks found. Expected at least one line like "- hunk: 42-55".`);
            }
            const artifact = { file, hunks };
            if (banner)
                artifact.banner = banner;
            return artifact;
        });
        if (artifacts.length === 0) {
            throw new Error(`Stop ${order} has no artifacts. Expected at least one "### Artifact: path/to/file.ts" section.`);
        }
        return {
            id: `stop-${order}`,
            order,
            title,
            narrative,
            importance: importance,
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
