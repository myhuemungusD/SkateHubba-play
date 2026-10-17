/** Camera and playback glyphs (recorder, replay, lens controls). */
import { SvgIcon, type IconProps } from "./iconBase";

export function CameraIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </SvgIcon>
  );
}

export function RecordIcon(props: IconProps) {
  return (
    <SvgIcon {...props} fill="currentColor" stroke="none">
      <circle cx="12" cy="12" r="8" />
    </SvgIcon>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <SvgIcon {...props} fill="currentColor" stroke="none">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </SvgIcon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <SvgIcon {...props} fill="currentColor" stroke="none">
      <polygon points="5 3 19 12 5 21 5 3" />
    </SvgIcon>
  );
}

export function ReplayIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </SvgIcon>
  );
}

export function FisheyeIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="10" />
      <ellipse cx="12" cy="12" rx="10" ry="6" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </SvgIcon>
  );
}

export function FlipCameraIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M20 5h-3.5l-1.5-2h-6L7.5 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
      <path d="M9 12.5a3 3 0 0 1 5.2-2" />
      <path d="M15 12.5a3 3 0 0 1-5.2 2" />
      <polyline points="14.2 7.6 14.2 10.5 11.3 10.5" />
      <polyline points="9.8 17.4 9.8 14.5 12.7 14.5" />
    </SvgIcon>
  );
}
