/** Bounded undo/redo stack. Entries are opaque to the stack. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private readonly cap = 40) {}

  push(entry: T): void {
    this.past.push(entry);
    if (this.past.length > this.cap) this.past.shift();
    this.future = [];
  }

  /** `swap` turns the undone entry into its redo entry (captures current state). */
  undo(swap: (entry: T) => T): boolean {
    const e = this.past.pop();
    if (e === undefined) return false;
    this.future.push(swap(e));
    return true;
  }

  redo(swap: (entry: T) => T): boolean {
    const e = this.future.pop();
    if (e === undefined) return false;
    this.past.push(swap(e));
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  clear(): void {
    this.past = [];
    this.future = [];
  }
}
