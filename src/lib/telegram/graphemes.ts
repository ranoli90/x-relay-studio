const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("und", { granularity: "grapheme" })
    : null;

export function graphemeCount(value: string): number {
  if (segmenter) return [...segmenter.segment(value)].length;
  return [...value].length;
}

export function sliceGraphemes(value: string, max: number): string {
  if (graphemeCount(value) <= max) return value;
  if (segmenter) {
    let out = "";
    let n = 0;
    for (const { segment } of segmenter.segment(value)) {
      if (n >= max) break;
      out += segment;
      n += 1;
    }
    return out;
  }
  return [...value].slice(0, max).join("");
}
