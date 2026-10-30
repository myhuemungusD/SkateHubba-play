/**
 * Who may open /pro, and how.
 *  - "pro":    a verified pro, with VITE_FEATURE_PRO_PROFILES on.
 *  - "review": an admin-claim holder (any flag state) previewing the screen.
 *  - null:     everyone else, including a verified pro while the flag is off.
 * Being a pro never implies admin: this grants the pro toolset only.
 */
type ProToolsAccess = "pro" | "review" | null;

export function resolveProToolsAccess(input: {
  flagOn: boolean;
  isVerifiedPro: boolean;
  isAdmin: boolean;
}): ProToolsAccess {
  if (input.flagOn && input.isVerifiedPro) return "pro" as const;
  if (input.isAdmin) return "review" as const;
  return null;
}
