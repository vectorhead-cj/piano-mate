const PAD_PX = 8;

/**
 * Whether a click landed on a staff's key signature. C major and A minor draw no signs, so
 * their place is the gap between the clef and the time signature.
 */
export function hitsKeySignature(root: Element, event: MouseEvent): boolean {
  const inside = (box: { left: number; right: number; top: number; bottom: number }) =>
    event.clientX >= box.left - PAD_PX &&
    event.clientX <= box.right + PAD_PX &&
    event.clientY >= box.top - PAD_PX &&
    event.clientY <= box.bottom + PAD_PX;
  const boxes = (selector: string) => [...root.querySelectorAll(selector)].map((el) => el.getBoundingClientRect());
  const signatures = boxes(".vf-keysignature");
  if (signatures.some(inside)) return true;
  const clefs = boxes(".vf-clef");
  const times = boxes(".vf-timesignature");
  return clefs.some((clef, i) => {
    const time = times[i];
    return time !== undefined && inside({ left: clef.right, right: time.left, top: clef.top, bottom: clef.bottom });
  });
}
