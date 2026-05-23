import { computeDuration } from '../../stores/toastStore';

describe('computeDuration', () => {
  it('short info shows for 2400ms base', () => {
    expect(computeDuration('hi', 'info')).toBe(2400);
  });

  it('short success shows for 2400ms base', () => {
    expect(computeDuration('done', 'success')).toBe(2400);
  });

  it('short warn shows for 3200ms base', () => {
    expect(computeDuration('warn', 'warn')).toBe(3200);
  });

  it('short error shows for 4000ms base', () => {
    expect(computeDuration('err', 'error')).toBe(4000);
  });

  it('long error message extends duration by 1s per 35 chars', () => {
    const msg = 'a'.repeat(36); // 1 extra block
    expect(computeDuration(msg, 'error')).toBe(5000);
  });

  it('very long error message caps at 8000ms', () => {
    const msg = 'x'.repeat(500); // ~14 extra blocks → would be 18000ms
    expect(computeDuration(msg, 'error')).toBe(8000);
  });

  it('override is respected with min 1000ms floor', () => {
    expect(computeDuration('hi', 'info', 6000)).toBe(6000);
    expect(computeDuration('hi', 'error', 500)).toBe(1000); // floored
  });

  it('error 34 chars uses base only (1 char below threshold)', () => {
    const msg = 'a'.repeat(34);
    expect(computeDuration(msg, 'error')).toBe(4000);
  });

  it('error exactly 35 chars adds 1 block (35/35=1)', () => {
    const msg = 'a'.repeat(35);
    expect(computeDuration(msg, 'error')).toBe(5000);
  });
});
