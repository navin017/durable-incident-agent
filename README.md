# Durable Incident Triage Agent

An AI workflow that survives a crash. If the process dies halfway through, it resumes from its last completed step instead of starting over, so finished work and LLM calls are not repeated.

Built with TypeScript, Node.js, [Dapr Workflows](https://docs.dapr.io/developing-applications/building-blocks/workflow/) and the Google Gemini API.

## The problem

AI workflows are slow, cost money per call, and run across several steps. A plain script that crashes at step 3 loses everything: you either rerun it and pay for the LLM call again, or you handle recovery yourself. Durable execution moves that recovery out of your code and into the runtime.

## What it does

An incident goes through four steps:

1. `loadContext` adds the owner team and recent deploy.
2. `classifyIncident` asks Gemini for severity, category and a summary, with retries and backoff.
3. `draftUpdate` writes the status update. This step is deliberately slow, so the demo can kill it.
4. `sendNotification` writes the update to an outbox.

## Run the demo

You need Node.js 22+ and the [Dapr CLI](https://docs.dapr.io/getting-started/install-dapr-cli/). Docker is not required.

```bash
dapr init --slim
npm install
npm run demo
```

The demo starts Dapr and a worker, starts a workflow, force-kills the worker in the middle of `draftUpdate`, restarts it, and then checks what really ran:

```text
> Crash: killing worker 32952 in the middle of draftUpdate
  status with no worker running: RUNNING

> Restarting the worker

time           pid    step                event
10:07:32.605   32952  loadContext         started
10:07:32.606   32952  loadContext         finished
10:07:32.631   32952  classifyIncident    started
10:07:32.632   32952  classifyIncident    finished
10:07:32.647   32952  draftUpdate         started     <-- killed here
10:07:36.323   7100   draftUpdate         started     <-- new process
10:07:41.335   7100   draftUpdate         finished
10:07:41.385   7100   sendNotification    started
10:07:41.392   7100   sendNotification    finished
```

`loadContext` and `classifyIncident` do not run again in the new process. The workflow stays `RUNNING` while no worker exists, and picks up as soon as one connects.

To use real Gemini responses, copy `.env.example` to `.env` and add your key. Without a key, a small rule-based mock is used.

## How it works

- **The workflow is replayed, not resumed from memory.** Dapr saves each step's result to its state store (SQLite here). After a restart it reruns the workflow function and feeds in the saved results, so completed `yield`s return immediately.
- **Workflow code must be deterministic.** It is replayed, so all I/O lives in activities. That is why `workflow.ts` has no network calls, file access or clock reads.
- **Activities run at least once.** The interrupted `draftUpdate` runs again, so a step that is cut off repeats. A crash just after `sendNotification` finishes could repeat it too, so the outbox is keyed on the workflow id and a retry does not send twice.
- **The journal is separate from Dapr.** `data/journal.jsonl` is written only by activities and is what the demo checks, so the proof does not rely on Dapr's own reporting.

## Limitations

- It is a demo: one worker, SQLite and an outbox file rather than a real notification service.
- The incident is hard-coded in `scripts/demo.ts`.
- Dapr's slim mode is for local development.
- Mock mode has no real LLM behaviour.

## Project layout

```text
src/workflow.ts     the deterministic workflow
src/activities.ts   the steps that do real work
src/classifier.ts   Gemini call and mock
src/worker.ts       registers the workflow and activities
src/journal.ts      records what actually ran
scripts/demo.ts     the crash test
components/         Dapr state store
```
