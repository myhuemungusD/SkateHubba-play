import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSave = vi.fn();
let deny = false;
vi.mock("../../../services/proProfile", () => ({
  // A plain async function (not the spy's return value) so a denied save is
  // a rejection only the component sees.
  saveProProfile: async (...args: unknown[]) => {
    mockSave(...args);
    if (deny) throw { code: "permission-denied" };
    return args[1];
  },
}));

import { ProProfileEditor } from "../ProProfileEditor";

describe("ProProfileEditor", () => {
  beforeEach(() => {
    mockSave.mockReset();
    deny = false;
  });

  it("saves a bio and up to three tricks", async () => {
    const onSaved = vi.fn();
    render(
      <ProProfileEditor
        uid="u1"
        initial={{ bio: "", signatureTricks: [], tagline: "", hometown: "", sponsors: [] }}
        onSaved={onSaved}
        onCancel={() => {}}
      />,
    );
    await userEvent.type(screen.getByLabelText("BIO"), "Hi");
    expect(screen.getByText("2/280")).toBeInTheDocument();
    for (const t of ["Kickflip", "Heelflip", "Hardflip"])
      await userEvent.click(screen.getByRole("button", { name: t }));
    expect(screen.getByRole("button", { name: "Ollie" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Kickflip" }));
    expect(screen.getByRole("button", { name: "Ollie" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "SAVE" }));
    expect(onSaved).toHaveBeenCalledWith({
      bio: "Hi",
      signatureTricks: ["Heelflip", "Hardflip"],
      tagline: "",
      hometown: "",
      sponsors: ["", "", ""],
    });
  });

  it("edits tagline, hometown and sponsors with empty fields and no placeholder copy", async () => {
    const onSaved = vi.fn();
    render(
      <ProProfileEditor
        uid="u1"
        initial={{ bio: "", signatureTricks: [], tagline: "", hometown: "Oakland", sponsors: ["A"] }}
        onSaved={onSaved}
        onCancel={() => {}}
      />,
    );
    for (const l of ["TAGLINE", "HOMETOWN", "Sponsor 1", "Sponsor 2", "Sponsor 3"])
      expect(screen.getByLabelText(l)).not.toHaveAttribute("placeholder");
    await userEvent.type(screen.getByLabelText("TAGLINE"), "Go");
    await userEvent.type(screen.getByLabelText("Sponsor 2"), "B");
    await userEvent.click(screen.getByRole("button", { name: "SAVE" }));
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ tagline: "Go", hometown: "Oakland", sponsors: ["A", "B", ""] }),
    );
  });

  it("shows an error and stays open when the save is denied", async () => {
    deny = true;
    const onSaved = vi.fn();
    render(
      <ProProfileEditor
        uid="u1"
        initial={{ bio: "a", signatureTricks: [], tagline: "", hometown: "", sponsors: [] }}
        onSaved={onSaved}
        onCancel={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "SAVE" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Try again.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
