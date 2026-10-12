/**
 * Custom tree views have no double-click event, so clicks are timed instead:
 * the same item clicked twice within a short time (the setting `doubleClickMs`, 400 ms at first) counts as a double click.
 */
export class DoubleClickTracker {
  private lastKey: string | undefined;
  private lastTime = 0;

  constructor(private readonly windowMs: () => number = () => 400) {}

  /** Call once per click. Returns true when this click completes a double click. */
  registerClick(key: string, now: number = Date.now()): boolean {
    const isDouble = key === this.lastKey && now - this.lastTime <= this.windowMs();
    // Reset after a double click so a third quick click starts over instead of counting again.
    this.lastKey = isDouble ? undefined : key;
    this.lastTime = now;
    return isDouble;
  }
}
