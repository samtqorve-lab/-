import { describe, it, expect } from 'vitest';
import { saveHandoff, takeHandoff, HANDOFF_KEY } from './pitDesignHandoff.js';

function fakeStorage(init = {}) {
  const m = { ...init };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    _m: m,
  };
}

describe('pitDesignHandoff', () => {
  it('ذخیره و یک‌بار مصرف: بار دوم null است', () => {
    const s = fakeStorage();
    expect(saveHandoff(s, { mineName: 'معدن الف', jobId: 'job-1' }, 1000)).toBe(true);
    expect(takeHandoff(s, 2000)).toEqual({ mineName: 'معدن الف', jobId: 'job-1' });
    expect(takeHandoff(s, 2000)).toBeNull();
    expect(HANDOFF_KEY in s._m).toBe(false);
  });
  it('بعد از ۱۰ دقیقه منقضی می‌شود (و حذف می‌شود)', () => {
    const s = fakeStorage();
    saveHandoff(s, { mineName: 'm', jobId: 'j' }, 0);
    expect(takeHandoff(s, 11 * 60 * 1000)).toBeNull();
    expect(HANDOFF_KEY in s._m).toBe(false);
  });
  it('ورودی ناقص/خراب خطا نمی‌دهد', () => {
    const s = fakeStorage();
    expect(saveHandoff(s, { mineName: '', jobId: 'j' })).toBe(false);
    expect(saveHandoff(s, { mineName: 'm' })).toBe(false);
    s.setItem(HANDOFF_KEY, '{bad json');
    expect(takeHandoff(s)).toBeNull();
    s.setItem(HANDOFF_KEY, JSON.stringify({ mineName: 'm' }));
    expect(takeHandoff(s)).toBeNull();
  });
  it('storage خراب (پر/خصوصی) → false بدون استثنا', () => {
    const bad = { setItem() { throw new Error('quota'); }, getItem() { throw new Error('x'); }, removeItem() {} };
    expect(saveHandoff(bad, { mineName: 'm', jobId: 'j' })).toBe(false);
    expect(takeHandoff(bad)).toBeNull();
  });
});
