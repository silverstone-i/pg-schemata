/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  warnOnce,
  _resetDeprecationWarnings,
} from '../../src/utils/deprecation.js';

describe('warnOnce', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetDeprecationWarnings();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns exactly once per key', () => {
    warnOnce('k1', 'first');
    warnOnce('k1', 'first');
    warnOnce('k1', 'first');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('prefixes messages with [pg-schemata]', () => {
    warnOnce('k2', 'something is deprecated');
    expect(warnSpy).toHaveBeenCalledWith(
      '[pg-schemata] something is deprecated'
    );
  });

  it('treats distinct keys independently', () => {
    warnOnce('k3', 'a');
    warnOnce('k4', 'b');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('warns again after _resetDeprecationWarnings', () => {
    warnOnce('k5', 'a');
    _resetDeprecationWarnings();
    warnOnce('k5', 'a');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
