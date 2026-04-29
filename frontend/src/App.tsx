import { useEffect, useState } from "react";

type HealthResponse = {
  status: string;
  dependencies: {
    postgres: string;
    redis: string;
  };
};

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

  useEffect(() => {
    let cancelled = false;

    const fetchHealth = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/health`);
        if (!response.ok) {
          throw new Error(`Health endpoint returned ${response.status}`);
        }

        const data = (await response.json()) as HealthResponse;
        if (!cancelled) {
          setHealth(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      }
    };

    void fetchHealth();
    const timer = setInterval(() => {
      void fetchHealth();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiBaseUrl]);

  return (
    <main className="container">
      <h1>API Gateway Tradeoff</h1>
      <p>Local development stack is running with Docker Compose.</p>

      <section className="card">
        <h2>Backend Health</h2>
        <p>
          API Base URL: <code>{apiBaseUrl}</code>
        </p>

        {error && <p className="error">Connection error: {error}</p>}

        {!error && !health && <p>Checking backend status...</p>}

        {health && (
          <ul>
            <li>Service status: {health.status}</li>
            <li>PostgreSQL: {health.dependencies.postgres}</li>
            <li>Redis: {health.dependencies.redis}</li>
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
