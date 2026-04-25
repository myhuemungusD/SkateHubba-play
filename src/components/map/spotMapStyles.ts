// Inject pulsing marker CSS once. Respects prefers-reduced-motion: users who
// opt out of motion (vestibular, accessibility) get a static ring instead of
// the infinite pulse — per WCAG 2.3.3.
export const PULSE_CSS_ID = "spot-pulse-css";

export function injectPulseCSS(): void {
  if (document.getElementById(PULSE_CSS_ID)) return;
  const style = document.createElement("style");
  style.id = PULSE_CSS_ID;
  style.textContent = `
    @keyframes spot-pulse {
      0%   { transform: scale(1);   opacity: 1; }
      70%  { transform: scale(2.2); opacity: 0; }
      100% { transform: scale(1);   opacity: 0; }
    }
    .spot-pulse-ring {
      position: absolute;
      inset: -6px;
      border-radius: 50%;
      border: 2px solid #F97316;
      animation: spot-pulse 1.8s ease-out infinite;
      pointer-events: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .spot-pulse-ring {
        animation: none;
        opacity: 0.7;
      }
    }
    .spot-user-dot {
      width: 12px;
      height: 12px;
      background: #F97316;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 0 6px rgba(249,115,22,0.5);
    }
    .spot-user-accuracy {
      position: absolute;
      width: 60px;
      height: 60px;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: rgba(249,115,22,0.15);
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}
