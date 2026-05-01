export type BaseDecisionLike = {
  allowed: boolean;
  retryAfterMs: number | null;
  algorithmState: unknown | null;
};

export type BaseEvent<TDecision> = {
  kind: string;
  decision: TDecision | null;
  ts: string;
};

export type BaseKpiStats<TDecision extends BaseDecisionLike> = {
  total: number;
  allowed: number;
  rejected: number;
  allowRate: number;
  rejectRate: number;
  latestDecision: TDecision | null;
  lastRetryAfterMs: number | null;
  observedRps: number;
  state: TDecision["algorithmState"];
};

export const deriveBaseKpiStats = <TEvent extends BaseEvent<BaseDecisionLike>>(
  events: TEvent[],
): BaseKpiStats<NonNullable<TEvent["decision"]>> => {
  type TDecision = NonNullable<TEvent["decision"]>;

  const decisionEvents = events.filter(
    (event): event is TEvent & { decision: TDecision } => event.kind === "decision" && event.decision !== null,
  );

  const total = decisionEvents.length;
  const allowed = decisionEvents.filter((event) => event.decision.allowed).length;
  const rejected = total - allowed;

  let latestDecision: TDecision | null = null;
  for (let index = decisionEvents.length - 1; index >= 0; index -= 1) {
    const current = decisionEvents[index].decision;
    if (current) {
      latestDecision = current;
      break;
    }
  }

  let lastRetryAfterMs: number | null = null;
  for (let index = decisionEvents.length - 1; index >= 0; index -= 1) {
    const current = decisionEvents[index].decision;
    if (!current.allowed && current.retryAfterMs !== null) {
      lastRetryAfterMs = current.retryAfterMs;
      break;
    }
  }

  const nowMs = Date.now();
  const observedRps = decisionEvents.filter((event) => {
    const tsMs = Date.parse(event.ts);
    return Number.isFinite(tsMs) && nowMs - tsMs <= 1000;
  }).length;

  return {
    total,
    allowed,
    rejected,
    allowRate: total > 0 ? allowed / total : 0,
    rejectRate: total > 0 ? rejected / total : 0,
    latestDecision,
    lastRetryAfterMs,
    observedRps,
    state: (latestDecision?.algorithmState ?? null) as TDecision["algorithmState"],
  };
};
