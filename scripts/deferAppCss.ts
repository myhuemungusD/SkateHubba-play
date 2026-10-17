/**
 * The app stylesheet is render-blocking. On signed-out /, /auth, and /feed the
 * LCP text is styled by /lcp.css, so the app CSS can load as print and be
 * applied after the first paint (see public/lcp-shell.js).
 */
export function deferAppStylesheet(html: string): string {
  return html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, (tag) => {
    if (!tag.includes("/assets/") || !tag.includes(".css")) return tag;
    if (/\bmedia=/.test(tag)) return tag;
    return tag.replace("<link", '<link media="print" data-app-css=""');
  });
}

/**
 * The entry module evaluates before first paint and becomes the LCP render
 * delay. Drop it (and its modulepreloads) from the document and point
 * /lcp-shell.js at the hashed file so the shell can paint first.
 */
export function deferAppEntry(html: string): string {
  const match = html.match(/<script type="module"[^>]*src="(\/assets\/[^"]+\.js)"[^>]*><\/script>/);
  if (!match?.[1]) return html;
  const src = match[1];
  const withoutEntry = html.replace(match[0], "");
  const withoutPreloads = withoutEntry.replace(/<link rel="modulepreload"[^>]*>\s*/g, "");
  return withoutPreloads.replace("</head>", `<meta name="app-entry" content="${src}"></head>`);
}
