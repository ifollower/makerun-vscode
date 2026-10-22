import { describe, expect, it } from 'vitest';
import { formatDuration } from '../src/duration';

describe('duration display', () => {
  it.each([
    [undefined, '—'], [0, '0ms'], [999, '999ms'], [1000, '1.0s'], [1234, '1.2s'],
    [59_999, '59.9s'], [60_000, '1m 0s'], [125_000, '2m 5s'], [3_723_000, '1h 2m 3s'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatDuration(value)).toBe(expected);
  });
});
