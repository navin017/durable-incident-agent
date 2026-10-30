import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DaprWorkflowClient, WorkflowRuntimeStatus } from "@dapr/dapr";
import { DATA_DIR, JOURNAL_PATH, type JournalEntry } from "../src/journal.js";
import type { Incident, TriageResult } from "../src/types.js";
import { WORKFLOW_NAME } from "../src/workflow.js";

const BIN = join(homedir(), ".dapr", "bin");
const EXE = process.platform === "win32" ? ".exe" : "";
const LOGS = join(DATA_DIR, "logs");
const GRPC_PORT = "50001";
const HTTP_PORT = "3500";
const children: ChildProcess[] = [];

const say = (message: string) => console.log(`\n> ${message}`);

function start(name: string, command: string, args: string[]): ChildProcess {
  const log = openSync(join(LOGS, `${name}.log`), "a");
  const child = spawn(command, args, { stdio: ["ignore", log, log] });
  closeSync(log);
  children.push(child);
  return child;
}

const startWorker = () =>
  start("worker", process.execPath, ["--env-file-if-exists=.env", "--import", "tsx", "src/worker.ts"]);

function journal(instanceId: string): JournalEntry[] {
  if (!existsSync(JOURNAL_PATH)) return [];
  return readFileSync(JOURNAL_PATH, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JournalEntry)
    .filter((entry) => entry.instanceId === instanceId);
}

async function waitFor(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // Not up yet.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}. See ${LOGS}.`);
}

async function main(): Promise<void> {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(LOGS, { recursive: true });

  say(`Starting Dapr (classifier: ${process.env.GEMINI_API_KEY ? "Gemini" : "mock, no GEMINI_API_KEY set"})`);
  start("placement", join(BIN, `placement${EXE}`), ["--port", "50005", "--healthz-port", "58080", "--metrics-port", "59090"]);
  start("scheduler", join(BIN, `scheduler${EXE}`), [
    "--port", "50006", "--healthz-port", "58081", "--metrics-port", "59091",
    "--etcd-data-dir", join(DATA_DIR, "scheduler"),
  ]);
  start("daprd", join(BIN, `daprd${EXE}`), [
    "--app-id", "incident-agent",
    "--dapr-grpc-port", GRPC_PORT,
    "--dapr-http-port", HTTP_PORT,
    "--metrics-port", "59092",
    "--resources-path", "components",
    "--placement-host-address", "127.0.0.1:50005",
    "--scheduler-host-address", "127.0.0.1:50006",
  ]);
  await waitFor("the Dapr sidecar", async () => (await fetch(`http://127.0.0.1:${HTTP_PORT}/v1.0/healthz`)).ok);

  say("Starting the worker");
  const firstWorker = startWorker();

  const incident: Incident = {
    id: "INC-1042",
    title: "Checkout API returning timeouts",
    description: "Error rate jumped to 18% after the latest deploy. Customers cannot complete payment.",
    service: "checkout-api",
  };
  const client = new DaprWorkflowClient({ daprHost: "127.0.0.1", daprPort: GRPC_PORT });
  const instanceId = await client.scheduleNewWorkflow(WORKFLOW_NAME, incident);
  say(`Scheduled workflow ${instanceId}`);

  await waitFor("the draftUpdate step", () =>
    journal(instanceId).some((entry) => entry.step === "draftUpdate" && entry.event === "started"),
  );
  say(`Crash: killing worker ${firstWorker.pid} in the middle of draftUpdate`);
  firstWorker.kill("SIGKILL");
  await new Promise((resolve) => firstWorker.once("exit", resolve));

  const midCrash = await client.getWorkflowState(instanceId, false);
  console.log(`  status with no worker running: ${midCrash ? WorkflowRuntimeStatus[midCrash.runtimeStatus] : "unknown"}`);
  await sleep(2000);

  say("Restarting the worker");
  startWorker();

  const state = await client.waitForWorkflowCompletion(instanceId, true, 90);
  await client.stop();
  if (!state || state.runtimeStatus !== WorkflowRuntimeStatus.COMPLETED) {
    throw new Error(`Workflow did not complete: ${state ? WorkflowRuntimeStatus[state.runtimeStatus] : "no state"}`);
  }

  const entries = journal(instanceId);
  say("What actually ran");
  console.table(
    entries.map((entry) => ({ time: entry.at.slice(11, 23), pid: entry.pid, step: entry.step, event: entry.event })),
  );

  const count = (step: string, event: JournalEntry["event"]) =>
    entries.filter((entry) => entry.step === step && entry.event === event).length;
  const checks: [string, boolean][] = [
    ["loadContext ran once", count("loadContext", "started") === 1],
    ["classifyIncident (the LLM call) ran once", count("classifyIncident", "started") === 1],
    ["draftUpdate was interrupted, then retried", count("draftUpdate", "started") === 2 && count("draftUpdate", "finished") === 1],
    ["sendNotification ran once", count("sendNotification", "finished") === 1],
    ["work ran in two different processes", new Set(entries.map((entry) => entry.pid)).size === 2],
    ["notification is in the outbox", existsSync(join(DATA_DIR, "outbox", `${instanceId}.json`))],
  ];

  say("Checks");
  for (const [label, passed] of checks) console.log(`  ${passed ? "PASS" : "FAIL"}  ${label}`);

  say("Workflow result");
  console.log(state.getOutput<TriageResult>());

  if (checks.some(([, passed]) => !passed)) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
}
process.exit();
