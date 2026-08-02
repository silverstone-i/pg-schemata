/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/utils/deprecation.ts
//
// Shared one-time deprecation warning helper. Each distinct key warns at most
// once per process so hot paths stay quiet after the first hit.

const warned = new Set<string>();

/**
 * Logs a deprecation warning once per key per process.
 *
 * @param key - Stable identifier for the deprecation site.
 * @param message - Warning text; the `[pg-schemata]` prefix is added here.
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[pg-schemata] ${message}`);
}

/**
 * Test-only: clears the once-per-key state. Not part of the public API.
 */
export function _resetDeprecationWarnings(): void {
  warned.clear();
}
