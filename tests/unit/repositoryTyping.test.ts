/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// Type-level only. `tsc --noEmit` is what checks these, and CI runs it.
//
// RepositoryMap used to be a union whose second arm was
// Record<string, RepositoryCtor>. With Repositories un-augmented the first arm
// collapsed to `{}`, which accepts any non-nullish value — so neither arm
// constrained anything, and DB.init accepted a string, an array, or a map
// missing half the declared repositories. The JSDoc claimed keys and instance
// types were checked against the registry; they were not.
//
// It is a conditional now, so the permissive form applies only while
// Repositories is un-augmented. The conditional is exercised through
// RepositoryMapFor<R> rather than by augmenting Repositories here: a
// `declare module` augmentation applies to the entire compilation unit, so it
// would break every other suite's DB.init call.

import { expectTypeOf, describe, it } from 'vitest';
import type { RepositoryMap, RepositoryMapFor } from '../../src/DB.js';
import type { RepositoryCtor } from '../../src/schemaTypes.js';

class Users {
  readonly kind = 'users' as const;
}
class Tenants {
  readonly kind = 'tenants' as const;
}

interface FakeRegistry {
  users: Users;
  tenants: Tenants;
}

type Augmented = RepositoryMapFor<FakeRegistry>;

// Real classes rather than `declare const`, so the file also executes. The
// runtime assertions are no-ops — expectTypeOf erases — but keeping the file in
// the suite means it cannot silently stop being compiled.
const UsersCtor: RepositoryCtor<Users> = Users;
const TenantsCtor: RepositoryCtor<Tenants> = Tenants;

describe('RepositoryMap with an augmented registry', () => {
  it('keys the map to the declared registry', () => {
    expectTypeOf<keyof Augmented>().toEqualTypeOf<'users' | 'tenants'>();
  });

  it('accepts a map declaring every repository with the right type', () => {
    const complete = { users: UsersCtor, tenants: TenantsCtor };
    expectTypeOf(complete).toMatchTypeOf<Augmented>();
  });

  it('rejects a map missing a declared repository', () => {
    const missingTenants = { users: UsersCtor };
    expectTypeOf(missingTenants).not.toMatchTypeOf<Augmented>();
  });

  it('rejects a constructor producing the wrong instance type', () => {
    // `tenants` is declared as Tenants, so a Users constructor must not satisfy
    // it. This is the case the old union could never catch.
    const swapped = { users: UsersCtor, tenants: UsersCtor };
    expectTypeOf(swapped).not.toMatchTypeOf<Augmented>();
  });

  it('rejects values that are not repository maps', () => {
    expectTypeOf<string>().not.toMatchTypeOf<Augmented>();
    expectTypeOf<unknown[]>().not.toMatchTypeOf<Augmented>();
  });
});

describe('RepositoryMap with no augmentation', () => {
  it('stays permissive, so existing consumers compile unchanged', () => {
    // How the package ships. Narrowing this would be a compile break for every
    // consumer that has not declared a registry.
    expectTypeOf<RepositoryMap>().toEqualTypeOf<
      Record<string, RepositoryCtor>
    >();
  });

  it('accepts an arbitrary map of constructors', () => {
    const arbitrary = { anything: UsersCtor, somethingElse: TenantsCtor };
    expectTypeOf(arbitrary).toMatchTypeOf<RepositoryMap>();
  });
});
