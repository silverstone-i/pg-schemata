'use strict';

/**
 * Module-level audit actor resolver.
 *
 * When set, TableModel methods call this function at query time to resolve
 * the current actor for created_by / updated_by fields.  The resolver takes
 * priority over the per-schema `_auditUserDefault` static fallback.
 *
 * @type {(() => string|null)|null}
 */
let _auditActorResolver = null;

/**
 * Registers a callback that returns the current actor ID (e.g. from
 * AsyncLocalStorage).  Called once at application startup.
 *
 * @param {() => string|null} fn - Synchronous function returning actor ID or null.
 * @throws {TypeError} If fn is not a function.
 */
export function setAuditActorResolver(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('auditActorResolver must be a function');
  }
  _auditActorResolver = fn;
}

/**
 * Clears any previously registered resolver.  Primarily useful in tests.
 */
export function clearAuditActorResolver() {
  _auditActorResolver = null;
}

/**
 * Returns the current actor by invoking the registered resolver, or null
 * if no resolver is set or the resolver returns a falsy value.
 *
 * @returns {string|null}
 */
export function getAuditActor() {
  return _auditActorResolver?.() ?? null;
}
