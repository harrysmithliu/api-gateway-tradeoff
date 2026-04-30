import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./pages/FixedWindowDashboard", () => ({
  FixedWindowDashboard: () => <div>Fixed Window Page</div>,
}));

vi.mock("./pages/SlidingLogDashboard", () => ({
  SlidingLogDashboard: () => <div>Sliding Log Page</div>,
}));

vi.mock("./pages/SlidingWindowCounterDashboard", () => ({
  SlidingWindowCounterDashboard: () => <div>Sliding Window Counter Page</div>,
}));

vi.mock("./pages/ComingSoonAlgorithmPage", () => ({
  ComingSoonAlgorithmPage: ({ title }: { title: string }) => <div>{title} Reserved Page</div>,
}));

import App from "./App";

describe("App routing tabs", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("defaults to fixed-window route and navigates to sliding-log", () => {
    render(<App />);

    expect(screen.getByText("Fixed Window Page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/fixed-window");

    fireEvent.click(screen.getByRole("link", { name: "Sliding Log" }));
    expect(screen.getByText("Sliding Log Page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/sliding-log");
  });

  it("enables sliding-window-counter tab without reserved suffix", () => {
    render(<App />);

    expect(screen.getByRole("link", { name: "Sliding Window Counter" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sliding Window Counter (Reserved)" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Sliding Window Counter" }));
    expect(screen.getByText("Sliding Window Counter Page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/sliding-window-counter");
  });

  it("keeps reserved tabs non-navigable", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "Token Bucket (Reserved)" }));
    expect(screen.getByText("Fixed Window Page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/fixed-window");
  });
});
