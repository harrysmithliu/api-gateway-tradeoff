import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SimulationControls } from "./SimulationControls";
import { DEFAULT_SLIDING_WINDOW_COUNTER_CONFIG } from "../../types/slidingWindowCounter";

describe("SimulationControls", () => {
  it("emits config updates and honors button state", () => {
    const onUpdateConfig = vi.fn();
    const onStart = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onStop = vi.fn();
    const onResetView = vi.fn();

    render(
      <SimulationControls
        config={DEFAULT_SLIDING_WINDOW_COUNTER_CONFIG}
        status="idle"
        onUpdateConfig={onUpdateConfig}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
        onResetView={onResetView}
      />,
    );

    fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "25" } });
    expect(onUpdateConfig).toHaveBeenCalledWith({ limit: 25 });

    fireEvent.change(screen.getByLabelText("Client ID Mode"), { target: { value: "rotating" } });
    expect(onUpdateConfig).toHaveBeenCalledWith({ clientIdMode: "rotating" });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });
});
