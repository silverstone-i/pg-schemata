import { generateZodFromTableSchema } from '../../src/utils/generateZodValidator.js';

const tableSchema = {
  table: 'test_table',
  dbSchema: 'public',
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'email', type: 'varchar(255)', notNull: false },
    { name: 'phone', type: 'varchar(20)', notNull: false },
    { name: 'notes', type: 'text', notNull: false },
    { name: 'is_active', type: 'boolean', notNull: true, default: true },
    { name: 'created_at', type: 'timestamp', notNull: true, default: 'now()' },
    { name: 'updated_at', type: 'timestamp', notNull: false },
  ],
};

const validators = generateZodFromTableSchema(tableSchema);
const { insertValidator, updateValidator, baseValidator } = validators;

const enumSchema = {
  ...tableSchema,
  columns: [...tableSchema.columns, { name: 'status', type: 'varchar(10)', notNull: false }],
  constraints: {
    checks: [
      { expression: "status IN ('active','inactive')" },
    ],
  },
};

console.log('enumSchema:', enumSchema);


const { insertValidator: enumInsert } = generateZodFromTableSchema(enumSchema);

const invalid = enumInsert.safeParse({
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  // email: 'a@b.com',
  // is_active: true,
  // created_at: new Date(),
  status: 'deleted',
});
if (invalid.success) {
  console.log('Unexpected pass for invalid enum:', invalid.data);
} else {
  console.log('Validation failed as expected:', invalid.error.format());
}
