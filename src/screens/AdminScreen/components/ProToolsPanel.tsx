import { Award, Gavel, Sparkles, Star, Swords, UserCog } from "lucide-react";
import { ComingSoonCard } from "../../../components/pro/ComingSoonCard";

const PRO_TOOLS = [
  {
    icon: <Gavel size={16} />,
    title: "Pro review queue",
    description:
      "Settle split What's That Trick votes: watch the clip, pick the trick, and your call becomes the label (proReviews).",
  },
  {
    icon: <Star size={16} />,
    title: "Gold clip authoring",
    description: "Mark clips with a known-correct trick so they can quietly check how reliable each voter is.",
  },
  {
    icon: <Swords size={16} />,
    title: "Pro challenges",
    description: "Post a trick for the community to match; best makes get featured and earn a pro-signed badge.",
  },
  {
    icon: <Sparkles size={16} />,
    title: "Featured clips",
    description: "Pin clips to the top of the feed and to your own profile reel.",
  },
  {
    icon: <UserCog size={16} />,
    title: "Pro profile editor",
    description: "Edit your bio, sponsors, hometown, stance and signature tricks yourself, with no code change needed.",
  },
  {
    icon: <Award size={16} />,
    title: "Pro badges",
    description: "Hand out a signature badge to skaters who beat you or nail your trick.",
  },
] as const;

/** Planned tools for verified pros. All placeholders until each one is built. */
export function ProToolsPanel() {
  return (
    <div className="space-y-3" data-testid="pro-tools-panel">
      <p className="font-body text-xs text-white/70">
        Tools verified pros will get. Designs are set; each one launches to testers first.
      </p>
      {PRO_TOOLS.map((t) => (
        <ComingSoonCard key={t.title} icon={t.icon} title={t.title} description={t.description} />
      ))}
    </div>
  );
}
