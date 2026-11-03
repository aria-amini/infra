// Severity labels. The gate owns exactly one `severity:*` label per PR.
export const SEVERITIES = ["low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const labelFor = (s: Severity) => `severity:${s}`;
export const LABEL_COLORS: Record<Severity, string> = { low: "0e8a16", medium: "fbca04", high: "d93f0b" };

/** The labels to add and remove so only the current severity label is left. Other labels are untouched. */
export function severityLabelChanges(current: string[], severity: Severity) {
  const want = labelFor(severity);
  const ours = SEVERITIES.map(labelFor);
  return {
    add: current.includes(want) ? [] : [want],
    remove: current.filter((l) => ours.includes(l) && l !== want),
  };
}

/** Jev's low_risk score to a severity. */
export function severityFromScore(lowRisk: number, threshold: number, highBelow: number): Severity {
  return lowRisk >= threshold ? "low" : lowRisk >= highBelow ? "medium" : "high";
}
