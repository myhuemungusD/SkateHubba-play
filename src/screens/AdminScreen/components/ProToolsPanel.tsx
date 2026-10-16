import { ComingSoonCard } from "../../../components/pro/ComingSoonCard";
import { PRO_TOOLS } from "../../../components/pro/proTools";

/** Planned tools for verified pros. All placeholders until each one is built. */
export function ProToolsPanel() {
  return (
    <div className="space-y-3" data-testid="pro-tools-panel">
      <p className="font-body text-xs text-white/70">
        Tools verified pros will get. Designs are set; each one launches to testers first. Pros open these from their
        own profile (Pro tools), with no admin access.
      </p>
      {PRO_TOOLS.map((t) => (
        <ComingSoonCard key={t.title} icon={t.icon} title={t.title} description={t.description} status={t.status} />
      ))}
    </div>
  );
}
