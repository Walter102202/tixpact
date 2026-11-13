import { describe, expect, it } from 'vitest';
import { matchPath } from './router';

describe('matchPath', () => {
  it('returns the parameters of a matching path', () => {
    expect(matchPath('/events/:id', '/events/3')).toEqual({ id: '3' });
    expect(matchPath('/tickets/:id', '/tickets/1-3/')).toEqual({ id: '1-3' });
    expect(matchPath('/', '/')).toEqual({});
  });

  it('returns null for another shape or an empty parameter', () => {
    expect(matchPath('/events/:id', '/events')).toBeNull();
    expect(matchPath('/events/:id', '/events/3/extra')).toBeNull();
    expect(matchPath('/events/:id', '/tickets/3')).toBeNull();
  });

  it('returns null instead of throwing on a malformed escape in the address', () => {
    expect(matchPath('/events/:id', '/events/%E0%A4%A')).toBeNull();
  });
});
