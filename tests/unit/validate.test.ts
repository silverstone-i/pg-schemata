/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect } from 'vitest';
import { isValidId, isPlainObject } from '../../src/utils/validation.js';

describe('isValidId', () => {
  it('should return true for finite numbers', () => {
    expect(isValidId(123)).toBe(true);
    expect(isValidId(0)).toBe(true);
    expect(isValidId(-456)).toBe(true);
  });

  it('should return false for non-finite numbers', () => {
    expect(isValidId(Infinity)).toBe(false);
    expect(isValidId(NaN)).toBe(false);
  });

  it('should return true for non-empty strings', () => {
    expect(isValidId('abc')).toBe(true);
    expect(isValidId('  id  ')).toBe(true);
  });

  it('should return false for empty or whitespace-only strings', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId('    ')).toBe(false);
  });

  it('should return false for other types', () => {
    expect(isValidId(null)).toBe(false);
    expect(isValidId(undefined)).toBe(false);
    expect(isValidId({})).toBe(false);
    expect(isValidId([])).toBe(false);
    expect(isValidId(true)).toBe(false);
  });
});

describe('isPlainObject', () => {
  it('should return true for plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ key: 'value' })).toBe(true);
  });

  it('should return false for arrays', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it('should return false for null', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it('should return false for primitive types', () => {
    expect(isPlainObject('string')).toBe(false);
    expect(isPlainObject(123)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });

  it('should return false for instances of classes', () => {
    class MyClass {}
    const instance = new MyClass();
    expect(isPlainObject(instance)).toBe(false);
  });
});
