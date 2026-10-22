/** Pure builders for the invite copy and per-network share links. */

export interface InviteSocial {
  name: string;
  icon: string;
  href: string;
}

export function inviteText(username?: string): string {
  return username
    ? `I'm playing S.K.A.T.E. on SkateHubba — challenge me! My handle: @${username}`
    : "Play me in a game of S.K.A.T.E. on SkateHubba.";
}

export function inviteSocials(text: string, url: string): InviteSocial[] {
  const encodedText = encodeURIComponent(`${text}\n${url}`);
  const encodedUrl = encodeURIComponent(url);
  return [
    { name: "X", icon: "𝕏", href: `https://twitter.com/intent/tweet?text=${encodedText}` },
    { name: "WhatsApp", icon: "WA", href: `https://wa.me/?text=${encodedText}` },
    { name: "Snapchat", icon: "SC", href: `https://www.snapchat.com/scan?attachmentUrl=${encodedUrl}` },
    { name: "Facebook", icon: "FB", href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    {
      name: "Reddit",
      icon: "Re",
      href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(text)}`,
    },
    { name: "Telegram", icon: "TG", href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(text)}` },
  ];
}

/** Flatten picked contacts into sanitized, non-empty phone numbers. */
export function contactPhones(contacts: ReadonlyArray<{ tel?: string[] }>): string[] {
  return contacts
    .flatMap((c) => c.tel || [])
    .filter(Boolean)
    .map((p) => p.replace(/[^0-9+\-().# ]/g, "").trim())
    .filter((p) => p.length > 0);
}
