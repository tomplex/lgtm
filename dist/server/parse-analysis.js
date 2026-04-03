const VALID_PRIORITIES = new Set(['critical', 'important', 'normal', 'low']);
const VALID_PHASES = new Set(['review', 'skim', 'rubber-stamp']);
export function parseFileAnalysis(input) {
    // Handle JSON fallback — agents sometimes produce JSON instead of markdown
    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        const result = {};
        for (const [path, entry] of Object.entries(parsed)) {
            const e = entry;
            if (!VALID_PRIORITIES.has(e.priority))
                throw new Error(`Invalid priority "${e.priority}" for file "${path}"`);
            if (!VALID_PHASES.has(e.phase))
                throw new Error(`Invalid phase "${e.phase}" for file "${path}"`);
            result[path] = {
                priority: e.priority,
                phase: e.phase,
                summary: e.summary ?? '',
                category: e.category ?? '',
            };
        }
        return result;
    }
    const result = {};
    const blocks = input.split(/^## /m).slice(1); // skip content before first ##
    for (const block of blocks) {
        const lines = block.split('\n');
        const filePath = lines[0].trim();
        if (!filePath)
            continue;
        let priority = '';
        let phase = '';
        let category = '';
        const summaryLines = [];
        let pastMetadata = false;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!pastMetadata && trimmed.startsWith('- priority:')) {
                priority = trimmed.replace('- priority:', '').trim();
            }
            else if (!pastMetadata && trimmed.startsWith('- phase:')) {
                phase = trimmed.replace('- phase:', '').trim();
            }
            else if (!pastMetadata && trimmed.startsWith('- category:')) {
                category = trimmed.replace('- category:', '').trim();
            }
            else if (!pastMetadata && trimmed === '') {
                pastMetadata = true;
            }
            else if (pastMetadata && trimmed !== '') {
                summaryLines.push(trimmed);
            }
        }
        if (!VALID_PRIORITIES.has(priority)) {
            throw new Error(`Invalid priority "${priority}" for file "${filePath}"`);
        }
        if (!VALID_PHASES.has(phase)) {
            throw new Error(`Invalid phase "${phase}" for file "${filePath}"`);
        }
        result[filePath] = {
            priority: priority,
            phase: phase,
            summary: summaryLines.join(' '),
            category,
        };
    }
    return result;
}
export function parseSynthesis(input) {
    // Handle JSON fallback — agents sometimes produce JSON instead of markdown
    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        const overview = parsed.overview ?? '';
        const reviewStrategy = parsed.reviewStrategy ?? '';
        const opinion = parsed.opinion ?? '';
        const rawGroups = parsed.groups ?? [];
        if (!overview)
            throw new Error('Missing overview in JSON');
        if (!reviewStrategy)
            throw new Error('Missing reviewStrategy in JSON');
        const groups = rawGroups.map(g => {
            const group = {
                name: g.name,
                files: g.files,
            };
            if (g.description)
                group.description = g.description;
            return group;
        });
        return { overview, reviewStrategy, opinion, groups };
    }
    const sections = new Map();
    const parts = input.split(/^## /m).slice(1);
    for (const part of parts) {
        const newlineIdx = part.indexOf('\n');
        const heading = part.slice(0, newlineIdx).trim().toLowerCase();
        const body = part.slice(newlineIdx + 1).trim();
        sections.set(heading, body);
    }
    const overview = sections.get('overview') ?? '';
    const reviewStrategy = sections.get('review strategy') ?? '';
    const opinion = sections.get('opinion') ?? '';
    const groupsRaw = sections.get('groups') ?? '';
    if (!overview)
        throw new Error('Missing ## Overview section');
    if (!reviewStrategy)
        throw new Error('Missing ## Review Strategy section');
    const groups = [];
    const groupBlocks = groupsRaw.split(/^### /m).slice(1);
    for (const block of groupBlocks) {
        const lines = block.split('\n');
        const name = lines[0].trim();
        if (!name)
            continue;
        let description;
        const files = [];
        for (let i = 1; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('- ')) {
                files.push(trimmed.slice(2).trim());
            }
            else if (trimmed !== '' && files.length === 0) {
                description = trimmed;
            }
        }
        const group = { name, files };
        if (description)
            group.description = description;
        groups.push(group);
    }
    return { overview, reviewStrategy, opinion, groups };
}
