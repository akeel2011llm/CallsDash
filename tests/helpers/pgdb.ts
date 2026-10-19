import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/** In-process Postgres with a stub of Supabase's `auth` schema, for testing the migration and the pg data layer. */
export async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  `);
  await db.exec(readFileSync(path.join(import.meta.dirname, "../../supabase/migrations/0001_init.sql"), "utf8"));
  return db;
}
