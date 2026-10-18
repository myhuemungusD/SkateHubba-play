import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddSpotLocationStep } from "../AddSpotLocationStep";

const base = { pinLatText: "1", pinLngText: "2" };

describe("AddSpotLocationStep", () => {
  it("reports typed coordinates as text plus parsed number", () => {
    const onLat = vi.fn();
    const onLng = vi.fn();
    render(<AddSpotLocationStep {...base} userLocation={null} onLat={onLat} onLng={onLng} onNext={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "12.5" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-3" } });
    expect(onLat).toHaveBeenCalledWith("12.5", 12.5);
    expect(onLng).toHaveBeenCalledWith("-3", -3);
    expect(screen.queryByText("Use my current location")).not.toBeInTheDocument();
  });

  it("fills the pin from the current location and advances on Next", () => {
    const onLat = vi.fn();
    const onLng = vi.fn();
    const onNext = vi.fn();
    render(
      <AddSpotLocationStep {...base} userLocation={{ lat: 10, lng: 20 }} onLat={onLat} onLng={onLng} onNext={onNext} />,
    );
    fireEvent.click(screen.getByText("Use my current location"));
    expect(onLat).toHaveBeenCalledWith("10", 10);
    expect(onLng).toHaveBeenCalledWith("20", 20);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
