import { pathToFileURL, fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
export function toFileUri(absPath) {
    return pathToFileURL(absPath).href;
}
export function fromFileUri(uri) {
    return fileURLToPath(uri);
}
export function realPath(p) {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return p;
    }
}
