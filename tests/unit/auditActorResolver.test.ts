/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  setAuditActorResolver,
  clearAuditActorResolver,
  getAuditActor,
} from '../../src/auditActorResolver.js';

describe('auditActorResolver', () => {
  beforeEach(() => {
    clearAuditActorResolver();
  });

  test('getAuditActor returns null when no resolver is set', () => {
    expect(getAuditActor()).toBeNull();
  });

  test('getAuditActor returns the value from the resolver', () => {
    setAuditActorResolver(() => 'user-123');
    expect(getAuditActor()).toBe('user-123');
  });

  test('getAuditActor returns null when resolver returns null', () => {
    setAuditActorResolver(() => null);
    expect(getAuditActor()).toBeNull();
  });

  test('getAuditActor returns null when resolver returns undefined', () => {
    // @ts-expect-error deliberately returns undefined instead of string | null
    setAuditActorResolver(() => undefined);
    expect(getAuditActor()).toBeNull();
  });

  test('clearAuditActorResolver removes the resolver', () => {
    setAuditActorResolver(() => 'user-123');
    clearAuditActorResolver();
    expect(getAuditActor()).toBeNull();
  });

  test('setAuditActorResolver throws TypeError for non-function', () => {
    // @ts-expect-error deliberately passes a string instead of a function
    expect(() => setAuditActorResolver('not a function')).toThrow(TypeError);
    // @ts-expect-error deliberately passes null instead of a function
    expect(() => setAuditActorResolver(null)).toThrow(TypeError);
    // @ts-expect-error deliberately passes a number instead of a function
    expect(() => setAuditActorResolver(42)).toThrow(TypeError);
  });

  test('resolver is called each time getAuditActor is invoked', () => {
    let callCount = 0;
    setAuditActorResolver(() => {
      callCount++;
      return `actor-${callCount}`;
    });
    expect(getAuditActor()).toBe('actor-1');
    expect(getAuditActor()).toBe('actor-2');
  });
});
