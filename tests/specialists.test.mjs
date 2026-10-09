import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/ai/specialists.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const specialists = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function select(message) {
  const chosen = specialists.selectSpecialists(message);
  return {
    ids: chosen.map((item) => item.id),
    tools: specialists.specialistToolNames(chosen),
  };
}

test("product questions select catalog and sales recommendation without lead mutation", () => {
  const result = select("What is the price and stock of this dress?");
  assert.ok(result.ids.includes("product_discovery"));
  assert.ok(result.ids.includes("sales_recommendation"));
  assert.ok(result.tools.has("get_price"));
  assert.ok(result.tools.has("check_inventory"));
  assert.equal(result.tools.has("create_lead"), false);
});

test("explicit buying intent enables lead creation only through qualification", () => {
  const result = select("I want to buy 10 pieces; my budget is 50000.");
  assert.ok(result.ids.includes("lead_qualification"));
  assert.ok(result.tools.has("create_lead"));
});

test("human request about an order includes handoff and order context", () => {
  const result = select("I want to speak to a human about my order.");
  assert.ok(result.ids.includes("human_support_handoff"));
  assert.ok(result.ids.includes("order_checkout"));
  assert.ok(result.tools.has("handoff_to_human"));
  assert.ok(result.tools.has("get_order"));
});

test("policy questions select Business Brain tools without write actions", () => {
  const result = select("What is your return policy?");
  assert.ok(result.ids.includes("business_brain_policy"));
  assert.ok(result.tools.has("get_business_policy"));
  assert.ok(result.tools.has("search_knowledge"));
  assert.equal(result.tools.has("create_order"), false);
  assert.equal(result.tools.has("schedule_followup"), false);
});

test("generic greeting cannot access lead creation or follow-up scheduling", () => {
  const result = select("Hello!");
  assert.deepEqual(result.ids, ["sales_recommendation"]);
  assert.equal(result.tools.has("create_lead"), false);
  assert.equal(result.tools.has("schedule_followup"), false);
  assert.equal(result.tools.has("create_order"), false);
});

test("customer history and retention intent remain bounded", () => {
  const history = select("Show my previous purchase history.");
  assert.ok(history.ids.includes("customer_context"));
  assert.ok(history.tools.has("get_customer"));
  const retention = select("Please remind me to reorder next month.");
  assert.ok(retention.ids.includes("retention_followup"));
  assert.equal(retention.tools.has("schedule_followup"), false);
});
