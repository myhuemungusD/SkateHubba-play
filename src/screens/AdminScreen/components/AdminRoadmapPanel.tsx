import { BarChart3, Ban, FileClock, Flag, Megaphone, Scale, Users } from "lucide-react";
import { ComingSoonCard } from "../../../components/pro/ComingSoonCard";
import { isAdminConsoleEnabled, isAdminInsightsEnabled, isAdminOpsEnabled } from "../../../lib/featureFlags";
import { AdminOpsPanel } from "./AdminOpsPanel";
import { AdminConsolePanel } from "./AdminConsolePanel";
import { AdminInsightsPanel } from "./AdminInsightsPanel";

/** Roadmap titles the admin console has built (hidden when its flag is on). */
/** Roadmap titles the admin ops panel has built. */
const ADMIN_OPS_BUILT = ["Disputes queue", "Audit log"];
const ADMIN_INSIGHTS_BUILT = ["Analytics", "Announcements"];
const ADMIN_CONSOLE_BUILT = ["Bans list", "User search", "Feature switches"];

const SECTIONS = [
  {
    icon: <Scale size={16} />,
    title: "Disputes queue",
    description: "Every open dispute in one list, with the clip, the votes so far, and a final ruling button.",
  },
  {
    icon: <Ban size={16} />,
    title: "Bans list",
    description:
      "See everyone currently banned, why, and by whom, and lift a ban from the list. Banning itself is live in Reports.",
  },
  {
    icon: <Users size={16} />,
    title: "User search",
    description: "Find any player by username or email and see their record, reports and badges in one place.",
  },
  {
    icon: <BarChart3 size={16} />,
    title: "Analytics",
    description: "Daily players, games started and finished, clips posted, and retention at a glance.",
  },
  {
    icon: <Flag size={16} />,
    title: "Feature switches",
    description: "See which features are on, off or tester-only, and who the testers are.",
  },
  {
    icon: <Megaphone size={16} />,
    title: "Announcements",
    description: "Send an in-app banner or push notification to everyone or a group.",
  },
  {
    icon: <FileClock size={16} />,
    title: "Audit log",
    description: "A history of every admin action: who did what, to whom, and when.",
  },
] as const;

/** Admin sections that are planned but not built yet. */
export function AdminRoadmapPanel() {
  const consoleOn = isAdminConsoleEnabled();
  const opsOn = isAdminOpsEnabled();
  const insightsOn = isAdminInsightsEnabled();
  const pending = SECTIONS.filter(
    (s) =>
      !(consoleOn && ADMIN_CONSOLE_BUILT.includes(s.title)) &&
      !(opsOn && ADMIN_OPS_BUILT.includes(s.title)) &&
      !(insightsOn && ADMIN_INSIGHTS_BUILT.includes(s.title)),
  );
  return (
    <div className="space-y-3" data-testid="admin-roadmap-panel">
      {consoleOn && <AdminConsolePanel />}
      {opsOn && <AdminOpsPanel />}
      {insightsOn && <AdminInsightsPanel />}
      {pending.length > 0 && (
        <p className="font-body text-xs text-white/70">
          Live today: Verify Pro, Awards, Reports (resolve, ban, hide dispute) and Clips. Coming next:
        </p>
      )}
      {pending.map((s) => (
        <ComingSoonCard key={s.title} icon={s.icon} title={s.title} description={s.description} />
      ))}
    </div>
  );
}
