/**
 * Gives jsdom elements a scrollable geometry for the duration of a test.
 *
 * jsdom performs no layout, so every element reports `clientHeight` and
 * `scrollHeight` as 0. `MessageScroller` reads those once, when its viewport
 * ref attaches, and afterwards treats a changed `clientHeight` as the viewport
 * having been resized — a resize clips the live edge without the reader
 * having done anything, so the scroller keeps following instead of parking a
 * jump control.
 *
 * A test that defines the geometry *after* rendering therefore stages
 * something a browser never does: a viewport that grows from zero height in
 * the same moment the reader scrolls. The scroller correctly ignores it, and
 * the test sees no jump control. Installing the metrics before the render
 * lets the component seed itself the way it does in a browser, where layout
 * has already run by the time the ref callback fires.
 *
 * Returns a restore function; call it in `afterEach`.
 */
export function stubViewportMetrics({
  clientHeight,
  scrollHeight,
}: {
  readonly clientHeight: number;
  readonly scrollHeight: number;
}): () => void {
  const target = HTMLElement.prototype;
  const previousClientHeight = Object.getOwnPropertyDescriptor(
    target,
    "clientHeight",
  );
  const previousScrollHeight = Object.getOwnPropertyDescriptor(
    target,
    "scrollHeight",
  );

  Object.defineProperty(target, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  Object.defineProperty(target, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });

  return () => {
    restore(target, "clientHeight", previousClientHeight);
    restore(target, "scrollHeight", previousScrollHeight);
  };
}

function restore(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(target, property, descriptor);
  else delete (target as Record<string, unknown>)[property];
}
