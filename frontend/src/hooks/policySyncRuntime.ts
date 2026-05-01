type PolicySyncStatus = "idle" | "loading" | "ready" | "syncing" | "error";

type StatusSetter = (status: PolicySyncStatus) => void;
type MessageSetter = (message: string | null) => void;
type ActivePolicySetter<TPolicy> = (policy: TPolicy | null) => void;
type ConfigSetter<TConfig> = (updater: (previous: TConfig) => TConfig) => void;

type ReloadPolicyParams<TPolicy, TConfig> = {
  mountedRef: { current: boolean };
  setPolicySyncStatus: StatusSetter;
  setPolicySyncMessage: MessageSetter;
  setActivePolicy: ActivePolicySetter<TPolicy>;
  setConfig: ConfigSetter<TConfig>;
  fetchActivePolicy: () => Promise<TPolicy | null>;
  applyLoadedPolicyToConfig: (previous: TConfig, policy: TPolicy) => TConfig;
  loadedMessage: (policy: TPolicy) => string;
  emptyMessage: string;
};

type SyncPolicyBeforeStartParams<TPolicy, TConfig> = {
  mountedRef: { current: boolean };
  resolvedConfig: TConfig;
  setPolicySyncStatus: StatusSetter;
  setPolicySyncMessage: MessageSetter;
  setActivePolicy: ActivePolicySetter<TPolicy>;
  setConfig: ConfigSetter<TConfig>;
  syncingMessage: string;
  syncPolicy: (resolvedConfig: TConfig) => Promise<TPolicy>;
  applySyncedPolicyToConfig: (resolvedConfig: TConfig, policy: TPolicy) => TConfig;
  syncedMessage: (policy: TPolicy) => string;
  appendSyntheticError: (message: string) => void;
};

const resolveErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === "object" && error !== null) {
    const maybeMessage = "message" in error ? error.message : undefined;
    const maybeStatus = "status" in error ? error.status : undefined;

    if (typeof maybeMessage === "string" && typeof maybeStatus === "number") {
      return `${maybeMessage} (HTTP ${maybeStatus})`;
    }
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

export const reloadPolicyFromBackend = async <TPolicy, TConfig>(
  params: ReloadPolicyParams<TPolicy, TConfig>,
): Promise<void> => {
  const {
    mountedRef,
    setPolicySyncStatus,
    setPolicySyncMessage,
    setActivePolicy,
    setConfig,
    fetchActivePolicy,
    applyLoadedPolicyToConfig,
    loadedMessage,
    emptyMessage,
  } = params;

  setPolicySyncStatus("loading");

  try {
    const backendPolicy = await fetchActivePolicy();
    if (!mountedRef.current) {
      return;
    }

    if (backendPolicy) {
      setActivePolicy(backendPolicy);
      setConfig((previous) => applyLoadedPolicyToConfig(previous, backendPolicy));
      setPolicySyncStatus("ready");
      setPolicySyncMessage(loadedMessage(backendPolicy));
      return;
    }

    setActivePolicy(null);
    setPolicySyncStatus("ready");
    setPolicySyncMessage(emptyMessage);
  } catch (error) {
    if (!mountedRef.current) {
      return;
    }

    setPolicySyncStatus("error");
    setPolicySyncMessage(resolveErrorMessage(error, "Failed to load active policy."));
  }
};

export const syncPolicyBeforeStart = async <TPolicy, TConfig>(
  params: SyncPolicyBeforeStartParams<TPolicy, TConfig>,
): Promise<TConfig | null> => {
  const {
    mountedRef,
    resolvedConfig,
    setPolicySyncStatus,
    setPolicySyncMessage,
    setActivePolicy,
    setConfig,
    syncingMessage,
    syncPolicy,
    applySyncedPolicyToConfig,
    syncedMessage,
    appendSyntheticError,
  } = params;

  setPolicySyncStatus("syncing");
  setPolicySyncMessage(syncingMessage);

  try {
    const syncedPolicy = await syncPolicy(resolvedConfig);
    if (!mountedRef.current) {
      return null;
    }

    const effectiveConfig = applySyncedPolicyToConfig(resolvedConfig, syncedPolicy);
    setActivePolicy(syncedPolicy);
    setConfig(() => effectiveConfig);
    setPolicySyncStatus("ready");
    setPolicySyncMessage(syncedMessage(syncedPolicy));

    return effectiveConfig;
  } catch (error) {
    if (!mountedRef.current) {
      return null;
    }

    const message = resolveErrorMessage(error, "Failed to sync policy.");
    setPolicySyncStatus("error");
    setPolicySyncMessage(message);
    appendSyntheticError(`Policy sync failed: ${message}`);
    return null;
  }
};
