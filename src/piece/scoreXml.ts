import { pianoPart } from "./parseMusicXml";

/** Attribute elements that carry on from bar to bar until changed. */
const CARRIED = ["divisions", "key", "time", "staves"] as const;

/**
 * The MusicXML to draw: the piano part alone, without the file's own line and page breaks
 * so it lays out to the screen. Given bars (measure indices, inclusive), only those, with
 * the signatures and clefs in force at the first, and without repeat signs (a phrase plays
 * once) unless `repeats` keeps them.
 */
export function scoreXml(xml: string, bars?: { from: number; to: number; repeats?: boolean }): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  const part = pianoPart(root);
  const partId = part.getAttribute("id");
  for (const other of [...root.children].filter((node) => node.tagName === "part" && node !== part)) other.remove();
  const partList = [...root.children].find((node) => node.tagName === "part-list");
  if (partList) {
    for (const entry of [...partList.children]) {
      if (entry.tagName !== "score-part" || entry.getAttribute("id") !== partId) entry.remove();
    }
  }
  // Titles are shown by the app, not drawn on the score.
  for (const node of [...root.children]) {
    if (["credit", "work", "movement-title", "movement-number"].includes(node.tagName)) node.remove();
  }
  for (const print of [...part.getElementsByTagName("print")]) print.remove();

  if (bars) {
    const carried = new Map<string, Element>();
    const clefs = new Map<string, Element>();
    const measures = [...part.children].filter((node) => node.tagName === "measure");
    measures.forEach((measure, index) => {
      if (index < bars.from) {
        for (const attributes of [...measure.children].filter((node) => node.tagName === "attributes")) {
          for (const node of attributes.children) {
            if ((CARRIED as readonly string[]).includes(node.tagName)) carried.set(node.tagName, node);
            if (node.tagName === "clef") clefs.set(node.getAttribute("number") ?? "1", node);
          }
        }
      }
      if (index < bars.from || index > bars.to) measure.remove();
    });
    const first = measures[bars.from];
    if (first && (carried.size > 0 || clefs.size > 0)) {
      // In the score's own namespace (none): createElement could give an HTML element.
      const attributes = doc.createElementNS(root.namespaceURI, "attributes");
      for (const name of CARRIED) {
        const node = carried.get(name);
        if (node) attributes.append(node.cloneNode(true));
      }
      for (const clef of clefs.values()) attributes.append(clef.cloneNode(true));
      first.insertBefore(attributes, first.firstChild);
    }
    for (const barline of bars.repeats ? [] : [...part.getElementsByTagName("barline")]) {
      for (const node of [...barline.children]) if (node.tagName === "repeat" || node.tagName === "ending") node.remove();
    }
  }
  return new XMLSerializer().serializeToString(doc);
}
