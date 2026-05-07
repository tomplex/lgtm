export function computeFreshness(input) {
    const { storedFiles, currentDiff, synthesizedAtFileSet } = input;
    const staleFiles = [];
    const missingFiles = [];
    const removedFiles = [];
    // Files in stored: check stale or removed.
    for (const [path, entry] of Object.entries(storedFiles)) {
        const cur = currentDiff.get(path);
        if (!cur) {
            removedFiles.push(path);
            continue;
        }
        const storedBase = entry.analyzedAtBaseBlob ?? '';
        const storedHead = entry.analyzedAtHeadBlob ?? '';
        if (storedBase !== cur.oldBlob || storedHead !== cur.newBlob) {
            staleFiles.push(path);
        }
    }
    // Files in current diff but not in stored: missing.
    for (const path of currentDiff.keys()) {
        if (!(path in storedFiles)) {
            missingFiles.push(path);
        }
    }
    // Synthesis is stale if any file is stale/missing/removed OR fileSet differs.
    const currentFileSet = new Set(Object.keys(storedFiles).filter(p => !removedFiles.includes(p)));
    for (const p of missingFiles)
        currentFileSet.add(p);
    const synthesizedSet = new Set(synthesizedAtFileSet);
    const fileSetDiffers = currentFileSet.size !== synthesizedSet.size ||
        [...currentFileSet].some(p => !synthesizedSet.has(p));
    const staleSynthesis = staleFiles.length > 0 ||
        missingFiles.length > 0 ||
        removedFiles.length > 0 ||
        fileSetDiffers;
    staleFiles.sort();
    missingFiles.sort();
    removedFiles.sort();
    return { staleFiles, missingFiles, removedFiles, staleSynthesis };
}
