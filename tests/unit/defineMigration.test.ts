/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect } from 'vitest';
import { defineMigration } from '../../src/migrate/defineMigration.js';

const up = async () => undefined;

describe('defineMigration', () => {
  it('rejects a missing or empty id', () => {
    // @ts-expect-error deliberately omits id
    expect(() => defineMigration({ up })).toThrow(
      'id must be a non-empty string'
    );
    expect(() => defineMigration({ id: '', up })).toThrow(
      'id must be a non-empty string'
    );
    expect(() => defineMigration({ id: '   ', up })).toThrow(
      'id must be a non-empty string'
    );
    // @ts-expect-error deliberately passes a number
    expect(() => defineMigration({ id: 42, up })).toThrow(
      'id must be a non-empty string'
    );
  });

  it('rejects a non-function up', () => {
    // @ts-expect-error deliberately passes a string
    expect(() => defineMigration({ id: 'a', up: 'nope' })).toThrow(
      'up must be a function (id "a")'
    );
  });

  it('rejects a non-string description', () => {
    // @ts-expect-error deliberately passes a number
    expect(() => defineMigration({ id: 'a', description: 7, up })).toThrow(
      'description must be a string when present (id "a")'
    );
  });

  it('returns a frozen object', () => {
    const migration = defineMigration({ id: 'a', up });
    expect(Object.isFrozen(migration)).toBe(true);
    expect(() => {
      // @ts-expect-error mutation of a readonly property
      migration.id = 'b';
    }).toThrow();
  });

  it('computes a deterministic 64-hex sha256 checksum', () => {
    const a1 = defineMigration({ id: 'a', description: 'd', up });
    const a2 = defineMigration({ id: 'a', description: 'd', up });
    expect(a1.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(a1.checksum).toBe(a2.checksum);
  });

  it('changes the checksum when id, description, or up body change', () => {
    const base = defineMigration({ id: 'a', description: 'd', up });
    const otherId = defineMigration({ id: 'b', description: 'd', up });
    const otherDescription = defineMigration({ id: 'a', description: 'e', up });
    const otherUp = defineMigration({
      id: 'a',
      description: 'd',
      up: async () => null,
    });
    expect(otherId.checksum).not.toBe(base.checksum);
    expect(otherDescription.checksum).not.toBe(base.checksum);
    expect(otherUp.checksum).not.toBe(base.checksum);
  });

  it('treats an omitted description like an empty string (documented)', () => {
    const omitted = defineMigration({ id: 'a', up });
    const empty = defineMigration({ id: 'a', description: '', up });
    expect(omitted.checksum).toBe(empty.checksum);
  });
});
