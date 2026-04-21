import { pathToFileURL, fileURLToPath } from 'node:url';
import * as fs from 'node:fs';

export function toFileUri(absPath: string): string {
  return pathToFileURL(absPath).href;
}

export function fromFileUri(uri: string): string {
  return fileURLToPath(uri);
}

export function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}
