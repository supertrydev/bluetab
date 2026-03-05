/**
 * @module utils/ring-buffer
 *
 * WHY:  Accumulating data stores (stats, RSS articles, session backups) grow without
 *       bound and exhaust the 10MB chrome.storage.local quota.
 *       Without a bounded buffer, a single feature can fill storage and break
 *       core tab saving for the user.
 *
 * WHAT: Fixed-capacity FIFO buffer that evicts oldest entries when full.
 *       Provides push (append + evict) and trim (reduce to size) operations.
 *
 * HOW:  Pure array operations — no side effects, no persistence.
 *       push() appends item and slices off the oldest if over maxSize.
 *       trim() keeps the newest toSize items by slicing from the end.
 *
 * NOT:  Does not handle persistence — callers use Storage.get/set.
 *       Does not mutate the input array — all operations return new arrays.
 */

export class RingBuffer<T> {
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  /**
   * Append an item to the buffer, evicting the oldest item if at capacity.
   *
   * @param buffer - Current buffer contents
   * @param item - New item to append
   * @returns New buffer with item appended (and oldest evicted if needed)
   */
  push(buffer: T[], item: T): T[] {
    const next = [...buffer, item];
    if (next.length > this.maxSize) {
      return next.slice(next.length - this.maxSize);
    }
    return next;
  }

  /**
   * Trim a buffer to a target size, keeping the newest items.
   *
   * @param buffer - Buffer to trim
   * @param toSize - Maximum number of items to keep
   * @returns Buffer trimmed to toSize (unchanged if already within limit)
   */
  trim(buffer: T[], toSize: number): T[] {
    if (buffer.length <= toSize) return buffer;
    return buffer.slice(buffer.length - toSize);
  }
}
