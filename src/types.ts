export interface Incident {
  id: string;
  title: string;
  description: string;
  service: string;
}

export interface EnrichedIncident extends Incident {
  recentDeploy: string;
  ownerTeam: string;
}

export type Severity = "critical" | "high" | "medium" | "low";

export interface Triage {
  severity: Severity;
  category: string;
  summary: string;
  source: "gemini" | "mock";
}

export interface TriageResult {
  incidentId: string;
  triage: Triage;
  update: string;
  notificationId: string;
}
