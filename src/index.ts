/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

export { DB, db, pgp } from './DB.js';
export type {
  ConnectionInput,
  DbInitOptions,
  ExtendedDb,
  RepositoryMap,
} from './DB.js';
export { TableModel } from './TableModel.js';
export { QueryModel } from './QueryModel.js';
export { callDb } from './utils/callDB.js';
export type { SchemaAwareModel } from './utils/callDB.js';
export { SchemaDefinitionError } from './SchemaDefinitionError.js';
export { DatabaseError } from './DatabaseError.js';
export type { PgErrorLike } from './DatabaseError.js';
export {
  setAuditActorResolver,
  clearAuditActorResolver,
  getAuditActor,
} from './auditActorResolver.js';

// Migration support
export { MigrationManager } from './migrate/MigrationManager.js';
export type {
  ApplyAllResult,
  MigrationManagerOptions,
  PendingMigrationInfo,
} from './migrate/MigrationManager.js';
export { defineMigration } from './migrate/defineMigration.js';
export type { DefineMigrationInput } from './migrate/defineMigration.js';
export type {
  Migration,
  MigrationContext,
  MigrationModule,
  ModuleDescriptor,
} from './migrate/types.js';
export {
  getModelKey,
  getTableDependencies,
  isTableModel,
  orderModels,
  resolveModuleOrder,
  topoSort,
} from './migrate/modelPlanner.js';
export type { TableModelLike } from './migrate/modelPlanner.js';
export { bootstrap } from './migrate/bootstrap.js';
export type { BootstrapOptions } from './migrate/bootstrap.js';
export {
  SchemaMigrations,
  migrationSchema,
} from './models/SchemaMigrations.js';
export type { SchemaMigrationRow } from './models/SchemaMigrations.js';

// Public schema types
export type {
  AuditActorResolver,
  AuditFieldsConfig,
  CheckConstraintDefinition,
  ColProps,
  ColPropsContext,
  ColumnDefinition,
  ConstraintDefinition,
  Constraints,
  DbConnection,
  ForeignKeyReference,
  IndexColumn,
  IndexDefinition,
  Logger,
  LogLevel,
  Repositories,
  RepositoryCtor,
  Row,
  TableSchema,
  TableValidators,
  UniqueConstraintDefinition,
} from './schemaTypes.js';

// Public query types
export { CONDITION_OPERATORS, PG_ERROR_MESSAGES } from './queryTypes.js';
export type {
  ConditionOperator,
  CursorOptions,
  CursorPage,
  FieldConditions,
  FiltersInput,
  FindOptions,
  JoinType,
  OperatorCondition,
  PgErrorCode,
  QueryOptions,
  Scalar,
  TxOption,
  WhereClauseResult,
  WhereCondition,
  WhereInput,
} from './queryTypes.js';
