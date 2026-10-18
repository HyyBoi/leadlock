import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false } });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
console.log("migrations applied");
await pool.end();
