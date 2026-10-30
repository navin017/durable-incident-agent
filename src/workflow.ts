import type { RetryPolicy, Task, WorkflowContext } from "@dapr/dapr";
import { classifyIncident, draftUpdate, loadContext, sendNotification } from "./activities.js";
import type { EnrichedIncident, Incident, Triage, TriageResult } from "./types.js";

export const WORKFLOW_NAME = "incidentTriage";

const llmRetry: RetryPolicy = {
  firstRetryInterval: 2,
  maxNumberOfAttempts: 4,
  backoffCoefficient: 2,
  maxRetryInterval: 30,
};

// Dapr rebuilds this function's state by replaying it after a restart, so it
// must stay deterministic: all I/O belongs in activities.
export function* incidentTriage(
  ctx: WorkflowContext,
  incident: Incident,
): Generator<Task<any>, TriageResult, any> {
  const instanceId = ctx.getWorkflowInstanceId();

  ctx.setCustomStatus("loading context");
  const enriched: EnrichedIncident = yield ctx.callActivity(loadContext, { ...incident, instanceId });

  ctx.setCustomStatus("classifying");
  const triage: Triage = yield ctx.callActivity(
    classifyIncident,
    { ...enriched, instanceId },
    { retryPolicy: llmRetry },
  );

  ctx.setCustomStatus("drafting update");
  const update: string = yield ctx.callActivity(draftUpdate, { instanceId, incident: enriched, triage });

  ctx.setCustomStatus("sending notification");
  const notificationId: string = yield ctx.callActivity(sendNotification, { instanceId, update });

  ctx.setCustomStatus("done");
  return { incidentId: incident.id, triage, update, notificationId };
}
