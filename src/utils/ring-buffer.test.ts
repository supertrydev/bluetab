/**
 * Unit tests for RingBuffer
 *
 * Tests: push eviction, trim, edge cases
 */

import { RingBuffer } from './ring-buffer';

describe('RingBuffer', () => {
  describe('push()', () => {
    it('evicts oldest item when capacity is exceeded', () => {
      const rb = new RingBuffer<number>(3);
      const result = rb.push([1, 2, 3], 4);
      expect(result).toEqual([2, 3, 4]);
    });

    it('does not evict when under capacity', () => {
      const rb = new RingBuffer<number>(5);
      const result = rb.push([1, 2], 3);
      expect(result).toEqual([1, 2, 3]);
    });

    it('handles empty buffer', () => {
      const rb = new RingBuffer<number>(1);
      const result = rb.push([], 1);
      expect(result).toEqual([1]);
    });

    it('evicts correctly at exact capacity (maxSize=1)', () => {
      const rb = new RingBuffer<number>(1);
      const result = rb.push([1], 2);
      expect(result).toEqual([2]);
    });

    it('keeps newest items on eviction', () => {
      const rb = new RingBuffer<number>(3);
      const result = rb.push([10, 20, 30], 40);
      expect(result).toEqual([20, 30, 40]);
    });
  });

  describe('trim()', () => {
    it('reduces buffer to target size keeping newest items', () => {
      const rb = new RingBuffer<number>(10);
      const result = rb.trim([1, 2, 3, 4, 5], 3);
      expect(result).toEqual([3, 4, 5]);
    });

    it('returns original buffer when already under target size', () => {
      const rb = new RingBuffer<number>(10);
      const result = rb.trim([1, 2], 5);
      expect(result).toEqual([1, 2]);
    });

    it('returns same reference when no trim needed', () => {
      const rb = new RingBuffer<number>(10);
      const buffer = [1, 2];
      const result = rb.trim(buffer, 5);
      expect(result).toBe(buffer);
    });
  });
});
