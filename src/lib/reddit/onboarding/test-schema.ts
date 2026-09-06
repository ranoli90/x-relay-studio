import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SqlLike } from "./sql.ts";

const MIGRATION_DIR = new URL("../../../../migrations/", import.meta.url);

function migrationSql(name: string): string {
  return readFileSync(new URL(name, MIGRATION_DIR), "utf8");
}

export function toSql(pg: PGlite): SqlLike {
  return {
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

/** Stub tables 0027/0028/0029 alter, then apply those migrations from disk. */
export async function loadOnboardingSchema(pg: PGlite): Promise<void> {
  await pg.exec(`
    create table reddit_apps (
      user_id text primary key,
      client_id text not null,
      client_secret text not null,
      user_agent_name text not null,
      redirect_uri text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table reddit_accounts (
      id text primary key,
      user_id text not null,
      reddit_id text not null,
      name text not null,
      onboarded_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, reddit_id)
    );
    create table reddit_oauth_tickets (
      ticket text primary key,
      user_id text not null,
      state text not null,
      redirect_uri text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );
  `);
  await pg.exec(migrationSql("0027_reddit_onboarding.sql"));
  await pg.exec(migrationSql("0028_reddit_onboarding_backfill.sql"));
  await pg.exec(migrationSql("0029_reddit_onboarding_lifecycle.sql"));
}

export async function schema(pg: PGlite): Promise<void> {
  await loadOnboardingSchema(pg);
}
