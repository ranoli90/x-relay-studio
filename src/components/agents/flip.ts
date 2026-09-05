import { useLayoutEffect, useRef } from "react";

/** FLIP list rows when order changes. Transform/opacity only; respects reduced motion. */
export function useFlipList(ids: string[]) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const prev = useRef(new Map<string, number>());
  const key = ids.join("|");

  useLayoutEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    const list = key.length ? key.split("|") : [];
    for (const id of list) {
      const el = nodes.current.get(id);
      if (!el) continue;
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const last = prev.current.get(id);
      if (last == null || reduced) continue;
      const dy = last - top;
      if (Math.abs(dy) < 2) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      el.style.opacity = "0.65";
      const run = () => {
        el.style.transition =
          "transform var(--motion-fast) var(--ease-out), opacity var(--motion-fast) var(--ease-out)";
        el.style.transform = "";
        el.style.opacity = "";
      };
      requestAnimationFrame(() => requestAnimationFrame(run));
    }
    prev.current = next;
  }, [key]);

  return (id: string) => (node: HTMLElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };
}
