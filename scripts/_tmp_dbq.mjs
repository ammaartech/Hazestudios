import pg from "pg";
import { dbConfig } from "./db-config.mjs";
const c = new pg.Client(dbConfig());
await c.connect();
console.log((await c.query("select version()")).rows[0].version);
await c.end();
