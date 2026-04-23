export interface HunkRef {
  newStart: number;
  newLines: number;
}

export interface StopArtifact {
  file: string;
  hunks: HunkRef[];
  banner?: string;
}

export interface Stop {
  id: string;
  order: number;
  title: string;
  narrative: string;
  importance: 'primary' | 'supporting' | 'minor';
  artifacts: StopArtifact[];
}

export interface Walkthrough {
  summary: string;
  stops: Stop[];
  diffHash: string;
  generatedAt: string;
}

export interface WalkthroughResponse {
  walkthrough: Walkthrough | null;
  stale: boolean;
}
