import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DobRow, type DobField } from "../DobRow";

function Harness({ initial = { month: "", day: "", year: "" } }: { initial?: Record<DobField, string> }) {
  const [dob, setDob] = useState(initial);
  return <DobRow {...dob} onChange={(field, value) => setDob((d) => ({ ...d, [field]: value }))} />;
}

const month = () => screen.getByLabelText("Birth month");
const day = () => screen.getByLabelText("Birth day");
const year = () => screen.getByLabelText("Birth year");

describe("DobRow auto-advance", () => {
  it("moves MM → DD → YYYY as each box fills", async () => {
    render(<Harness />);
    await userEvent.click(month());
    await userEvent.keyboard("04152001");
    expect(month()).toHaveValue("04");
    expect(day()).toHaveValue("15");
    expect(year()).toHaveValue("2001");
    expect(year()).toHaveFocus();
  });

  it("stays put after a single digit and strips non-digits", async () => {
    render(<Harness />);
    await userEvent.click(month());
    await userEvent.keyboard("1a");
    expect(month()).toHaveValue("1");
    expect(month()).toHaveFocus();
  });

  it("does not jump when editing an already-full box (delete then retype)", async () => {
    render(<Harness initial={{ month: "12", day: "", year: "" }} />);
    await userEvent.click(month());
    await userEvent.keyboard("{Backspace}");
    expect(month()).toHaveValue("1");
    expect(month()).toHaveFocus();
    await userEvent.keyboard("1");
    expect(month()).toHaveValue("11");
    expect(day()).toHaveFocus();
  });

  it("never advances out of the year box", async () => {
    render(<Harness />);
    await userEvent.click(year());
    await userEvent.keyboard("20");
    expect(year()).toHaveFocus();
  });
});
