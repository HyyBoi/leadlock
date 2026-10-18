import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const g = globalThis as unknown as { __pool?: pg.Pool; __db?: NodePgDatabase<typeof schema> };

function makePool() {
  const url = process.env.DATABASE_URL ?? "";
  return new pg.Pool({
    connectionString: url,
    max: 8,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });
}

export const pool = g.__pool ?? (g.__pool = makePool());
export const db = g.__db ?? (g.__db = drizzle(pool, { schema }));
export type DB = typeof db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export { schema };
