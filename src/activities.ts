import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { WorkflowActivityContext } from "@dapr/dapr";
import { classify } from "./classifier.js";
import { DATA_DIR, record } from "./journal.js";
import type { EnrichedIncident, Incident, Triage } from "./types.js";

const DRAFT_WORK_MS = Number(process.env.DRAFT_WORK_MS ?? 5000);

type WithInstance<T> = T & { instanceId: string };

export async function loadContext(
  _ctx: WorkflowActivityContext,
  { instanceId, ...incident }: WithInstance<Incident>,
): Promise<EnrichedIncident> {
  record("loadContext", "started", instanceId);
  const enriched = { ...incident, recentDeploy: "v2.14.0, 25 minutes ago", ownerTeam: "platform" };
  record("loadContext", "finished", instanceId);
  return enriched;
}

export async function classifyIncident(
  _ctx: WorkflowActivityContext,
  { instanceId, ...incident }: WithInstance<EnrichedIncident>,
): Promise<Triage> {
  record("classifyIncident", "started", instanceId);
  const triage = await classify(incident);
  record("classifyIncident", "finished", instanceId);
  return triage;
}

export async function draftUpdate(
  _ctx: WorkflowActivityContext,
  input: { instanceId: string; incident: EnrichedIncident; triage: Triage },
): Promise<string> {
  const { instanceId, incident, triage } = input;
  record("draftUpdate", "started", instanceId);
  // Stands in for slow work, and gives the demo a window to kill the worker.
  await sleep(DRAFT_WORK_MS);
  const update = `[${triage.severity.toUpperCase()}] ${triage.summary.replace(/\.+$/, "")}. Owner: ${incident.ownerTeam}. Recent deploy: ${incident.recentDeploy}.`;
  record("draftUpdate", "finished", instanceId);
  return update;
}

// Activities run at least once: a crash just after this finishes would run it
// again. Keying the outbox file on the workflow id keeps a retry from sending twice.
export async function sendNotification(
  _ctx: WorkflowActivityContext,
  { instanceId, update }: { instanceId: string; update: string },
): Promise<string> {
  record("sendNotification", "started", instanceId);
  const outbox = join(DATA_DIR, "outbox");
  mkdirSync(outbox, { recursive: true });
  const path = join(outbox, `${instanceId}.json`);
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify({ instanceId, update, sentAt: new Date().toISOString() }, null, 2));
  }
  record("sendNotification", "finished", instanceId);
  return instanceId;
}
