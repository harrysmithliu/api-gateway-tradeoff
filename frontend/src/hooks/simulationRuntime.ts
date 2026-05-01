export type SimulationRuntimeControl = {
  stopRequested: boolean;
  pauseRequested: boolean;
  dispatchSequence: number;
  inFlight: Set<Promise<void>>;
};

export type SimulationLoadConfig = {
  durationSec: number;
  rps: number;
  concurrency: number;
};

export type SimulationClientConfig = {
  clientIdMode: "single" | "rotating";
  singleClientId: string;
  rotatingPoolSize: number;
};

export const createRuntimeControl = (): SimulationRuntimeControl => ({
  stopRequested: false,
  pauseRequested: false,
  dispatchSequence: 0,
  inFlight: new Set(),
});

export const createSessionId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const resolveSimulationClientId = (
  runtime: SimulationRuntimeControl,
  config: SimulationClientConfig,
): string => {
  if (config.clientIdMode === "single") {
    return config.singleClientId;
  }

  const poolIndex = runtime.dispatchSequence % config.rotatingPoolSize;
  runtime.dispatchSequence += 1;
  return `client-${poolIndex + 1}`;
};

export const runSimulationDispatchLoop = async (params: {
  runtime: SimulationRuntimeControl;
  config: SimulationLoadConfig;
  dispatch: () => Promise<void>;
}): Promise<void> => {
  const { runtime, config, dispatch } = params;

  const simulationDeadline = Date.now() + config.durationSec * 1000;

  let tokenBudget = 0;
  let lastTickMs = Date.now();

  while (!runtime.stopRequested) {
    const nowMs = Date.now();

    if (nowMs >= simulationDeadline) {
      break;
    }

    if (runtime.pauseRequested) {
      await sleep(60);
      continue;
    }

    const elapsedMs = nowMs - lastTickMs;
    lastTickMs = nowMs;
    tokenBudget += (elapsedMs / 1000) * config.rps;
    tokenBudget = Math.min(tokenBudget, config.rps * 2);

    let dispatched = false;
    while (
      tokenBudget >= 1 &&
      runtime.inFlight.size < config.concurrency &&
      !runtime.stopRequested &&
      !runtime.pauseRequested
    ) {
      tokenBudget -= 1;
      dispatched = true;

      const task = dispatch().finally(() => {
        runtime.inFlight.delete(task);
      });
      runtime.inFlight.add(task);
    }

    if (!dispatched) {
      await sleep(12);
    }
  }

  if (runtime.inFlight.size > 0) {
    await Promise.allSettled(Array.from(runtime.inFlight));
  }
};

export const resetRuntimeAfterStop = (runtime: SimulationRuntimeControl): void => {
  runtime.stopRequested = false;
  runtime.pauseRequested = false;
};
