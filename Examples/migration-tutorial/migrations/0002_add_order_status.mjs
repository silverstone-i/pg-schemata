export async function up({ db, schema }) {
  await db.none(
    `ALTER TABLE "${schema}"."orders"
       ADD COLUMN status varchar(20) NOT NULL DEFAULT 'pending',
       ADD COLUMN shipped_at timestamptz`
  );
}
