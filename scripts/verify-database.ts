import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
async function main() {
  const { pool } = await import("../src/server/db");
  const db = await pool.connect();
  try {
    await db.query("begin");
    const a = randomUUID(),
      b = randomUUID(),
      member = randomUUID(),
      owner = randomUUID(),
      c1 = randomUUID(),
      c2 = randomUUID(),
      c3 = randomUUID(),
      order = randomUUID();
    await db.query("insert into auth.users (id,email) values ($1,$2),($3,$4)", [
      member,
      `mori-test-${member}@example.invalid`,
      owner,
      `mori-test-${owner}@example.invalid`,
    ]);
    await db.query(
      "insert into mori_tenants (id,name) values ($1,'Isolation A'),($2,'Isolation B')",
      [a, b],
    );
    await db.query(
      "insert into mori_memberships (tenant_id,user_id,role,name,email) values ($1,$2,'member','Test','test@example.invalid'),($1,$3,'head','Owner','owner@example.invalid')",
      [a, member, owner],
    );
    await db.query(
      "insert into mori_resources (tenant_id,id,name,type,token_encrypted,connected_by) values ($1,'test-page-a-'||$3,'Assigned','page','not-a-real-token',$4),($1,'test-page-b-'||$3,'Unassigned','page','not-a-real-token',$4),($2,'test-page-c-'||$3,'Other tenant','page','not-a-real-token',$4)",
      [a, b, a, owner],
    );
    const pa = `test-page-a-${a}`,
      pb = `test-page-b-${a}`,
      pc = `test-page-c-${a}`;
    await db.query(
      "insert into mori_assignments (tenant_id,user_id,resource_id) values ($1,$2,$3)",
      [a, member, pa],
    );
    await db.query(
      "insert into mori_contacts (tenant_id,id,page_id,name) values ($1,$3,$6,'Assigned'),($1,$4,$7,'Unassigned'),($2,$5,$8,'Other tenant')",
      [a, b, c1, c2, c3, pa, pb, pc],
    );
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: member, role: "authenticated" }),
    ]);
    const visible = await db.query(
      "select id from mori_contacts where id=any($1::uuid[])",
      [[c1, c2, c3]],
    );
    assert.deepEqual(
      visible.rows.map((r) => r.id),
      [c1],
    );
    assert.equal(
      (
        await db.query("update mori_contacts set notes='blocked' where id=$1", [
          c2,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (await db.query("select id from mori_resources where tenant_id=$1", [a]))
        .rows.length,
      1,
    );
    await db.query("savepoint token_check");
    await assert.rejects(
      db.query(
        "select token_encrypted from mori_resources where tenant_id=$1",
        [a],
      ),
      (e: any) => e.code === "42501",
    );
    await db.query("rollback to savepoint token_check");
    await db.query("savepoint cross_insert");
    await assert.rejects(
      db.query(
        "insert into mori_contacts (tenant_id,page_id,name) values ($1,$2,'Blocked')",
        [a, pb],
      ),
      (e: any) => e.code === "42501",
    );
    await db.query("rollback to savepoint cross_insert");
    await db.query("savepoint spoof_time");
    await assert.rejects(
      db.query("update mori_contacts set last_inbound_at=now() where id=$1", [
        c1,
      ]),
      (e: any) => e.code === "42501",
    );
    await db.query("rollback to savepoint spoof_time");
    await db.query('savepoint spoof_evidence');
    await assert.rejects(db.query("update mori_contacts set autofill_evidence='{}' where id=$1",[c1]),(e:any)=>e.code==='42501');
    await db.query('rollback to savepoint spoof_evidence');
    await db.query("savepoint fake_conversion");
    await assert.rejects(
      db.query("update mori_contacts set stage='converted' where id=$1", [c1]),
    );
    await db.query("rollback to savepoint fake_conversion");
    await db.query(
      "insert into mori_orders (id,tenant_id,contact_id,amount_minor,currency,status,paid_at) values ($1,$2,$3,100000,'PHP','paid',now())",
      [order, a, c1],
    );
    let converted = (
      await db.query(
        "select stage,converted_at from mori_contacts where id=$1",
        [c1],
      )
    ).rows[0];
    assert.equal(converted.stage, "converted");
    assert.ok(converted.converted_at);
    await db.query("update mori_orders set status='refunded' where id=$1", [
      order,
    ]);
    converted = (
      await db.query(
        "select stage,converted_at from mori_contacts where id=$1",
        [c1],
      )
    ).rows[0];
    assert.equal(converted.stage, "qualified");
    assert.equal(converted.converted_at, null);
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: owner, role: "authenticated" }),
    ]);
    assert.equal(
      (
        await db.query(
          "select id from mori_contacts where id=any($1::uuid[])",
          [[c1, c2, c3]],
        )
      ).rows.length,
      2,
    );
    console.log(
      "PASS: tenant isolation, Page assignment, token protection, write isolation, inbound timestamp and AI evidence protection, paid-order conversion, refund reversal, and head visibility.",
    );
  } catch (e) {
    console.error(
      "Database verification failed:",
      e instanceof Error ? e.message : "unknown",
    );
    process.exitCode = 1;
  } finally {
    await db.query("rollback");
    db.release();
    await pool.end();
    console.log("Test records rolled back; no customer data changed.");
  }
}
main();
