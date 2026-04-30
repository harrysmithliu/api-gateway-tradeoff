import { useEffect, useMemo, useState } from "react";

import { FixedWindowDashboard } from "./pages/FixedWindowDashboard";
import { LeakyBucketDashboard } from "./pages/LeakyBucketDashboard";
import { SlidingLogDashboard } from "./pages/SlidingLogDashboard";
import { SlidingWindowCounterDashboard } from "./pages/SlidingWindowCounterDashboard";
import { TokenBucketDashboard } from "./pages/TokenBucketDashboard";

type RouteConfig = {
  path: string;
  label: string;
  enabled: boolean;
  render: () => JSX.Element;
};

const ROUTES: RouteConfig[] = [
  {
    path: "/fixed-window",
    label: "Fixed Window",
    enabled: true,
    render: () => <FixedWindowDashboard />,
  },
  {
    path: "/sliding-log",
    label: "Sliding Log",
    enabled: true,
    render: () => <SlidingLogDashboard />,
  },
  {
    path: "/sliding-window-counter",
    label: "Sliding Window Counter",
    enabled: true,
    render: () => <SlidingWindowCounterDashboard />,
  },
  {
    path: "/token-bucket",
    label: "Token Bucket",
    enabled: true,
    render: () => <TokenBucketDashboard />,
  },
  {
    path: "/leaky-bucket",
    label: "Leaky Bucket",
    enabled: true,
    render: () => <LeakyBucketDashboard />,
  },
];

const DEFAULT_ROUTE = "/fixed-window";

const resolveRoutePath = (pathname: string): string => {
  if (pathname === "/") {
    return DEFAULT_ROUTE;
  }

  const matched = ROUTES.find((route) => route.path === pathname);
  if (matched) {
    return matched.path;
  }

  return DEFAULT_ROUTE;
};

function App() {
  const [currentPath, setCurrentPath] = useState(() => resolveRoutePath(window.location.pathname));

  useEffect(() => {
    const normalized = resolveRoutePath(window.location.pathname);
    if (normalized !== window.location.pathname) {
      window.history.replaceState(null, "", normalized);
    }
    setCurrentPath(normalized);

    const handlePopState = () => {
      const nextPath = resolveRoutePath(window.location.pathname);
      setCurrentPath(nextPath);
      if (nextPath !== window.location.pathname) {
        window.history.replaceState(null, "", nextPath);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const currentRoute = useMemo(
    () => ROUTES.find((route) => route.path === currentPath) ?? ROUTES[0],
    [currentPath],
  );

  const navigate = (path: string, enabled: boolean) => {
    if (!enabled) {
      return;
    }
    if (path === currentPath) {
      return;
    }
    window.history.pushState(null, "", path);
    setCurrentPath(path);
  };

  return (
    <div className="app-shell">
      <header className="app-top-nav card">
        <h1>Rate Limiter Visualization Console</h1>
        <nav className="tab-nav" aria-label="Algorithm tabs">
          {ROUTES.map((route) => {
            const isActive = route.path === currentRoute.path;
            return (
              <a
                key={route.path}
                href={route.path}
                className={`tab-link ${isActive ? "active" : ""} ${route.enabled ? "" : "disabled"}`.trim()}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={!route.enabled}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(route.path, route.enabled);
                }}
              >
                {route.label}
                {!route.enabled ? " (Reserved)" : ""}
              </a>
            );
          })}
        </nav>
      </header>

      {currentRoute.render()}
    </div>
  );
}

export default App;
