# Example: Reference-style Markdown Links

This Markdown file demonstrates how `[1]` → `#db` → `## DB` navigation works in VSCode using reference-style links.

---

## DB

DB is something

## DB

DB is a singleton utility class that initializes and provides access
to a configured pg-promise database instance. It also auto-attaches
custom repositories to the DB object on first initialization.

Use `DB.init(connection, repositories)` once at startup to initialize the DB.
Then access `DB.db` and `DB.pgp` as needed throughout your application.

### db

Subsection describing the internal `db` instance.

---

[1]: #db  
[2]: #db-1
[3]: #db-2