import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { generateZodFromTableSchema } from '../../src/utils/generateZodValidator.js';

describe('generateZodFromTableSchema', () => {
  const tableSchema = {
    table: 'test_table',
    dbSchema: 'public',
    columns: [
      { name: 'id', type: 'uuid', notNull: true },
      { name: 'email', type: 'varchar(255)', notNull: true },
      { name: 'phone', type: 'varchar(20)', notNull: false },
      { name: 'notes', type: 'text', notNull: false },
      { name: 'is_active', type: 'boolean', notNull: true, default: true },
      { name: 'created_at', type: 'timestamp', notNull: true, default: 'now()' },
      { name: 'updated_at', type: 'timestamp', notNull: false },
    ],
  };

  const validators = generateZodFromTableSchema(tableSchema);
  const { insertValidator, updateValidator, baseValidator } = validators;

  it('should require all non-nullable fields without defaults on insert', () => {
    const result = insertValidator.safeParse({ email: 'a@b.com', is_active: true, created_at: new Date() });
    expect(result.success).toBe(false);
    expect(result.error.issues.some(i => i.path.includes('id'))).toBe(true);
  });

  it('should allow optional nullable fields to be null on insert', () => {
    const input = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
      created_at: new Date(),
      phone: null,
      notes: null,
      updated_at: null,
    };
    const result = insertValidator.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should mark all update fields as optional and nullable', () => {
    const result = updateValidator.safeParse({ phone: null, notes: null });
    expect(result.success).toBe(true);
  });

  it('should fail on invalid email format in baseValidator', () => {
    const result = baseValidator.safeParse({ email: 'invalid', id: 'abc' });
    expect(result.success).toBe(false);
    expect(result.error.issues.some(i => i.path.includes('email'))).toBe(true);
  });

  it('should pass with valid UUID and proper email format', () => {
    const result = baseValidator.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'test@example.com',
      is_active: true,
      created_at: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('should enforce max length on varchar fields', () => {
    const result = insertValidator.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a'.repeat(256) + '@test.com',
      is_active: true,
      created_at: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('should coerce ISO string to date', () => {
    const result = insertValidator.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
      created_at: '2025-06-16T13:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('should allow defaulted fields to be missing in insert', () => {
    const minimal = insertValidator.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
    });
    expect(minimal.success).toBe(true);
  });

  it('should accept valid enum values and reject invalid ones', () => {
    const enumSchema = {
      ...tableSchema,
      columns: [
        ...tableSchema.columns,
        { name: 'status', type: 'varchar(10)', notNull: true }
      ],
      constraints: {
        checks: [
          { expression: "status IN ('active','inactive')" }
        ]
      }
    };

    const { insertValidator: enumInsert } = generateZodFromTableSchema(enumSchema);

    const valid = enumInsert.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
      created_at: new Date(),
      status: 'active',
    });
    expect(valid.success).toBe(true);

    const invalid = enumInsert.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
      created_at: new Date(),
      status: 'deleted',
    });
    expect(invalid.success).toBe(false);
  });
});
