/**
 * The pre-JS shells in index.html are the LCP text. They stay in the
 * document until React commits the real UI, then this removes them so they
 * cannot sit on top of the page or widen it. `data-lcp=done` also drops
 * the CSS that was keeping them displayed.
 */
export function dismissLcpShell(): void {
  document.documentElement.setAttribute("data-lcp", "done");
  document.querySelectorAll(".lcp-shell").forEach((node) => node.remove());
}
