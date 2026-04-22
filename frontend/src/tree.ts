import type { DiffFile, Analysis } from './state';

export interface FolderNode {
  kind: 'folder';
  id: string;
  name: string;
  fullPath: string;
  depth: number;
  children: TreeNode[];
}

export interface FileNode {
  kind: 'file';
  id: string;
  file: DiffFile;
  depth: number;
}

export type TreeNode = FolderNode | FileNode;

export interface BuildOpts {
  sort: 'path' | 'priority';
  group: 'none' | 'phase';
}

interface TrieNode {
  dirs: Map<string, TrieNode>;
  files: DiffFile[];
}

function emptyTrie(): TrieNode {
  return { dirs: new Map(), files: [] };
}

function insert(trie: TrieNode, file: DiffFile): void {
  const segments = file.path.split('/');
  const fileName = segments.pop()!;
  let node = trie;
  for (const seg of segments) {
    if (!node.dirs.has(seg)) node.dirs.set(seg, emptyTrie());
    node = node.dirs.get(seg)!;
  }
  node.files.push({ ...file, path: file.path });
  // Note: we store the file by its full path; the basename is `fileName` and used only for display.
  void fileName;
}

function buildFromTrie(trie: TrieNode, pathPrefix: string, depth: number, idPrefix: string): TreeNode[] {
  const out: TreeNode[] = [];

  for (const [dirName, sub] of trie.dirs) {
    const folderPath = pathPrefix + dirName + '/';
    const folder: FolderNode = {
      kind: 'folder',
      id: idPrefix + folderPath,
      name: dirName + '/',
      fullPath: folderPath,
      depth,
      children: buildFromTrie(sub, folderPath, depth + 1, idPrefix),
    };
    out.push(folder);
  }

  for (const f of trie.files) {
    out.push({
      kind: 'file',
      id: idPrefix + f.path,
      file: f,
      depth,
    });
  }

  return out;
}

export function buildTree(files: DiffFile[], _analysis: Analysis | null, _opts: BuildOpts): TreeNode[] {
  const trie = emptyTrie();
  for (const f of files) insert(trie, f);
  return buildFromTrie(trie, '', 0, '');
}
