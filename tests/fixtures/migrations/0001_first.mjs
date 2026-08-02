/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

export async function up({ db, schema }) {
  await db.none(
    `CREATE TABLE IF NOT EXISTS "${schema}"."fixture_first" (id int PRIMARY KEY)`
  );
}
