import { describe, expect, it } from 'vitest';
import { APP_NAME } from './brand.js';

describe('brand', () => {
  it('has a display name', () => {
    expect(APP_NAME.trim().length).toBeGreaterThan(0);
  });
});
