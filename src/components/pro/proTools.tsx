import type { ReactNode } from "react";
import { Award, Gavel, Sparkles, Star, Swords, UserCog } from "lucide-react";

export interface ProTool {
  icon: ReactNode;
  title: string;
  description: string;
  /** Set when the tool already works; replaces the COMING SOON tag. */
  status?: string;
}

/**
 * The verified-pro toolset. Single source for the admin Pro tab (review) and
 * the pro-only /pro screen. Every entry is a placeholder until built; none of
 * them writes anything, and Firestore has no pro write paths enabled yet.
 * Admin-only powers (bans, reports, clip moderation, verifying pros, awards)
 * deliberately do not belong in this list.
 */
export const PRO_TOOLS: readonly ProTool[] = [
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
    description:
      "Post a trick for the community to match; best makes get featured and earn a pro-signed shout-out (never a pro badge).",
  },
  {
    icon: <Sparkles size={16} />,
    title: "Featured clips",
    description: "Pin clips to the top of the feed and to your own profile reel.",
  },
  {
    icon: <UserCog size={16} />,
    title: "Pro profile editor",
    description:
      "Write your own tagline, hometown, sponsors and bio, and pick up to 3 signature tricks. Open Edit pro profile below.",
    status: "LIVE ON YOUR PROFILE",
  },
  {
    icon: <Award size={16} />,
    title: "Pro props",
    description:
      "Give a signature props sticker to skaters who beat you or nail your trick. Props are not pro status; only a blessing is.",
  },
];
