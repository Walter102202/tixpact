import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { matchPath, replaceHash, useHash } from './router';

describe('useHash and replaceHash', () => {
  it('follow the fragment and replace it without a new history entry', () => {
    window.history.replaceState(null, '', '/door');
    const { result } = renderHook(() => useHash());
    expect(result.current).toBe('');
    const entries = window.history.length;
    act(() => replaceHash('p=abc'));
    expect(result.current).toBe('#p=abc');
    expect(window.location.pathname).toBe('/door');
    expect(window.history.length).toBe(entries);
    act(() => replaceHash(''));
    expect(result.current).toBe('');
  });
});

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
