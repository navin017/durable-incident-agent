import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = "data";
export const JOURNAL_PATH = join(DATA_DIR, "journal.jsonl");

export interface JournalEntry {
  at: string;
  pid: number;
  step: string;
  event: "started" | "finished";
  instanceId: string;
}

// Records real executions on disk. Workflow code can replay, so this is only
// called from activities, and it is how the demo proves what ran and how often.
export function record(step: string, event: JournalEntry["event"], instanceId: string): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const entry: JournalEntry = { at: new Date().toISOString(), pid: process.pid, step, event, instanceId };
  appendFileSync(JOURNAL_PATH, JSON.stringify(entry) + "\n");
}
