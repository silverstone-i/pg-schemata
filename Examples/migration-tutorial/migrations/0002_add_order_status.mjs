// Adds the columns introduced in section 4 of the tutorial.
//
// IF NOT EXISTS matters here because migration 0001 calls bootstrap({ models }),
// which builds its DDL from the models as they exist *now* — not as they existed
// when 0001 was written. The committed ordersSchema already declares status and
// shipped_at, so on a fresh database 0001 creates them and this migration would
// otherwise fail with "column already exists".
//
// That is the general rule when bootstrap() and hand-written ALTERs share a
// migration history: the bootstrap step is always current, so every later
// structural change must tolerate having already been applied.
export async function up({ db, schema }) {
  await db.none(
    `ALTER TABLE "${schema}"."orders"
       ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'pending',
       ADD COLUMN IF NOT EXISTS shipped_at timestamptz`
  );
}
