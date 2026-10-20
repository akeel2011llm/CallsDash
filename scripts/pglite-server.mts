/** Local Postgres for development and UI tests: PGlite on a TCP port with the migration applied. `npx tsx scripts/pglite-server.mts [port]` */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.argv[2] ?? 5433);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;`);
await db.exec(readFileSync(new URL("../supabase/migrations/0001_init.sql", import.meta.url), "utf8"));
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
await server.start();
console.log(`pglite listening on ${port}`);
