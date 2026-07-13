import type { SessionArchivedTranscriptCleanupRule } from "./store.js";

export type SessionArchivedTranscriptFileCleanupParams = {
  directories: string[];
  rules: SessionArchivedTranscriptCleanupRule[];
  nowMs?: number;
  dryRun?: boolean;
  excludeCanonicalPaths?: ReadonlySet<string>;
  onRemoveFile?: (canonicalPath: string) => void;
};

export type SessionArchivedTranscriptFileCleanupResult = {
  removed: number;
  scanned: number;
};
