import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SimulationControls } from "./SimulationControls";
import { DEFAULT_TOKEN_BUCKET_CONFIG } from "../../types/tokenBucket";

describe("SimulationControls", () => {
  it("emits token-bucket config updates and honors button state", () => {
    const onUpdateConfig = vi.fn();
    const onStart = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onStop = vi.fn();
    const onResetView = vi.fn();

    render(
      <SimulationControls
        config={DEFAULT_TOKEN_BUCKET_CONFIG}
        status="idle"
        onUpdateConfig={onUpdateConfig}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
        onResetView={onResetView}
      />,
    );

    fireEvent.change(screen.getByLabelText("Capacity"), { target: { value: "30" } });
    expect(onUpdateConfig).toHaveBeenCalledWith({ capacity: 30 });

    fireEvent.change(screen.getByLabelText("Tokens / Request"), { target: { value: "2" } });
    expect(onUpdateConfig).toHaveBeenCalledWith({ tokensPerRequest: 2 });

    fireEvent.change(screen.getByLabelText("Client ID Mode"), { target: { value: "rotating" } });
    expect(onUpdateConfig).toHaveBeenCalledWith({ clientIdMode: "rotating" });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });
});
