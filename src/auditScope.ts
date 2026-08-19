/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/auditScope.ts
//
// Internal plumbing that binds an audit actor resolver to the models a
// specific database instance builds. The symbol is deliberately not exported
// from the package root: it is an implementation detail of instance scoping,
// not a public extension point.

import type { AuditActorResolver } from './schemaTypes.js';

/**
 * @private
 *
 * Carries a database instance's audit actor resolver on the models it builds.
 *
 * A symbol keeps the property out of `Object.keys` and JSON output, and it is
 * defined as *enumerable* on purpose: `QueryModel.forSchema()` clones with
 * `Object.assign`, which copies enumerable own string and symbol properties
 * only — a non-enumerable stamp would be lost on every schema-bound clone.
 */
export const AUDIT_RESOLVER: unique symbol = Symbol(
  'pg-schemata.auditActorResolver'
);

/** @private Structural shape of a model carrying a scoped resolver. */
export interface AuditScoped {
  [AUDIT_RESOLVER]?: AuditActorResolver;
}

/**
 * @private
 *
 * Stamps a scoped resolver onto a freshly constructed model. Called before
 * any `forSchema()` binding so clones inherit it.
 *
 * @param instance - The model instance to stamp.
 * @param resolver - The owning database's resolver, or null/undefined to
 *   leave the model on the legacy global fallback.
 * @returns The same instance, for call-site chaining.
 */
export function stampAuditResolver<T>(
  instance: T,
  resolver?: AuditActorResolver | null
): T {
  if (
    typeof resolver === 'function' &&
    typeof instance === 'object' &&
    instance !== null
  ) {
    Object.defineProperty(instance, AUDIT_RESOLVER, {
      value: resolver,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return instance;
}
