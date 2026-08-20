import pg from "pg";
import { dbConfig } from "./db-config.mjs";
const c = new pg.Client(dbConfig());
await c.connect();
const { rows:[cred] } = await c.query("select * from integration_credentials where provider='qikink' limit 1");
const host="https://api.qikink.com";
const tok=await (await fetch(`${host}/api/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({ClientId:cred.client_id,client_secret:cred.client_secret})})).json();
const remote=await (await fetch(`${host}/api/order`,{headers:{ClientId:cred.client_id,Accesstoken:tok.Accesstoken}})).json();
const parse=n=>{const m=String(n??"").match(/(\d+)\s*$/);return m?parseInt(m[1],10):null;};
const IST_OFFSET_MS = 5.5*3600*1000;
const DRY = !process.argv.includes("--commit");
console.log(DRY ? "DRY RUN\n" : "COMMITTING\n");
await c.query("begin");
for(const o of remote){
  if(o.status!=="On Hold") continue;
  const n=parse(o.number); if(n==null) continue;
  // created_on is IST; convert to real UTC instant.
  const utc=new Date(new Date(o.created_on.replace(" ","T")+"Z").getTime()-IST_OFFSET_MS);
  const r=await c.query(`
    update qikink_fulfillments f set stage_since=$2
    from orders o
    where o.id=f.order_id and o.order_number=$1 and f.stage='on_hold'
      and f.stage_since > $2
    returning o.order_number`,[n,utc.toISOString()]);
  if(r.rowCount) console.log(`  #${n}: stage_since -> ${utc.toISOString().slice(0,19)}Z  (held ${Math.round((Date.now()-utc)/3.6e6)}h)`);
}
if(DRY){await c.query("rollback");console.log("\nrolled back");}
else{await c.query("commit");console.log("\ncommitted");}
await c.end();
