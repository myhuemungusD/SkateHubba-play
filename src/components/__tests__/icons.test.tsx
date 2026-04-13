import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  TargetIcon,
  FilmIcon,
  VideoIcon,
  ClockIcon,
  HourglassIcon,
  XCircleIcon,
  SkullIcon,
  FlameIcon,
  TrophyIcon,
  ShieldIcon,
  FlagIcon,
  UsersIcon,
  SkateboardIcon,
  CameraIcon,
  RecordIcon,
  StopIcon,
  PlayIcon,
  ReplayIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  FisheyeIcon,
} from "../icons";

const allIcons = [
  { name: "TargetIcon", Component: TargetIcon },
  { name: "FilmIcon", Component: FilmIcon },
  { name: "VideoIcon", Component: VideoIcon },
  { name: "ClockIcon", Component: ClockIcon },
  { name: "HourglassIcon", Component: HourglassIcon },
  { name: "XCircleIcon", Component: XCircleIcon },
  { name: "SkullIcon", Component: SkullIcon },
  { name: "FlameIcon", Component: FlameIcon },
  { name: "TrophyIcon", Component: TrophyIcon },
  { name: "ShieldIcon", Component: ShieldIcon },
  { name: "FlagIcon", Component: FlagIcon },
  { name: "UsersIcon", Component: UsersIcon },
  { name: "SkateboardIcon", Component: SkateboardIcon },
  { name: "CameraIcon", Component: CameraIcon },
  { name: "RecordIcon", Component: RecordIcon },
  { name: "StopIcon", Component: StopIcon },
  { name: "PlayIcon", Component: PlayIcon },
  { name: "ReplayIcon", Component: ReplayIcon },
  { name: "ChevronRightIcon", Component: ChevronRightIcon },
  { name: "ChevronLeftIcon", Component: ChevronLeftIcon },
  { name: "FisheyeIcon", Component: FisheyeIcon },
];

describe("icons", () => {
  it.each(allIcons)("$name renders an SVG element", ({ Component }) => {
    const { container } = render(<Component />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it.each(allIcons)("$name applies custom size", ({ Component }) => {
    const { container } = render(<Component size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });

  it.each(allIcons)("$name applies custom className", ({ Component }) => {
    const { container } = render(<Component className="text-red-500" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("text-red-500");
  });

  it("uses default size of 20", () => {
    const { container } = render(<TargetIcon />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
  });

  it("RecordIcon uses fill instead of stroke", () => {
    const { container } = render(<RecordIcon />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveAttribute("stroke", "none");
  });
});
