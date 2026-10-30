import { WorkflowRuntime } from "@dapr/dapr";
import { classifyIncident, draftUpdate, loadContext, sendNotification } from "./activities.js";
import { incidentTriage, WORKFLOW_NAME } from "./workflow.js";

const runtime = new WorkflowRuntime({ daprHost: "127.0.0.1", daprPort: process.env.DAPR_GRPC_PORT ?? "50001" })
  .registerWorkflowByName(WORKFLOW_NAME, incidentTriage)
  .registerActivity(loadContext)
  .registerActivity(classifyIncident)
  .registerActivity(draftUpdate)
  .registerActivity(sendNotification);

await runtime.start();
console.log(`worker ready, pid ${process.pid}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void runtime.stop().finally(() => process.exit(0)));
}
