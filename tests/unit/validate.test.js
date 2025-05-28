import { describe, it, expect } from 'vitest';
import { isValidId, validateUUID, isPlainObject } from '../../src/utils/validation'; 

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

describe('validateUUID', () => {
  it('should return true for valid UUIDs', () => {
    expect(validateUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('should return false for invalid UUIDs', () => {
    expect(validateUUID('123e4567e89b12d3a456426614174000')).toBe(false); // missing hyphens
    expect(validateUUID('g23e4567-e89b-12d3-a456-426614174000')).toBe(false); // invalid character
    expect(validateUUID('')).toBe(false);
    expect(validateUUID('not-a-uuid')).toBe(false);
  });

  it('should return false for non-string input', () => {
    expect(validateUUID(123)).toBe(false);
    expect(validateUUID(null)).toBe(false);
    expect(validateUUID(undefined)).toBe(false);
    expect(validateUUID({})).toBe(false);
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