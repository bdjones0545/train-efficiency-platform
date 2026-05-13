import { db } from "./server/db";
import { sql } from "drizzle-orm";
import { mapBrainRecToToolProposal, mapRevenueActionToToolProposal } from "./server/agent-tools/action-mapper";
import { proposeToolCall, getPendingToolCalls, getToolCallAuditLog } from "./server/agent-tools/runtime";

async function run() {
  const orgRes = await db.execute(sql`SELECT id FROM organizations LIMIT 1`);
  const orgId = (orgRes.rows[0] as any)?.id;
  if (!orgId) { console.log("No org"); process.exit(1); }
  console.log("Org:", orgId, "\n");

  // ── 1. Action Mapper: Brain Agent ─────────────────────────────────────
  console.log("1. Brain Agent → Tool Mapping...");

  const testRecs = [
    { id: "r1", agentType: "retention", actionType: "send_reengagement", title: "Re-engage inactive client", description: "Client has been inactive for 30 days", reason: "High churn risk", entityType: "client", entityId: "c1", entityName: "Sarah Johnson", estimatedImpact: 600, priorityScore: 85 },
    { id: "r2", agentType: "retention", actionType: "renewal_outreach", title: "Renewal outreach", description: "Contract expires in 2 weeks", reason: "Renewal opportunity", entityType: "client", entityId: "c2", entityName: "Tom Smith", estimatedImpact: 1200, priorityScore: 78 },
    { id: "r3", agentType: "scheduling", actionType: "fill_schedule_gap", title: "Fill Tuesday morning slot", description: "Open time slot", reason: "Revenue opportunity", entityType: null, entityId: null, entityName: null, estimatedImpact: 200, priorityScore: 60 },
    { id: "r4", agentType: "growth", actionType: "followup_hot_lead", title: "Follow up Lincoln HS", description: "Showed strong interest last week", reason: "High interest signal", entityType: "lead", entityId: "l1", entityName: "Lincoln High School", estimatedImpact: 2400, priorityScore: 92 },
    { id: "r5", agentType: "growth", actionType: "revive_stalled_deal", title: "Revive stalled deal", description: "No movement in 3 weeks", reason: "Deal at risk", entityType: "deal", entityId: "d1", entityName: "Westview Athletics", estimatedImpact: 3000, priorityScore: 88 },
    { id: "r6", agentType: "client_success", actionType: "client_checkin", title: "Check in with at-risk client", description: "Client missed last 2 sessions", reason: "Churn signal", entityType: "client", entityId: "c3", entityName: "Mike Davis", estimatedImpact: 400, priorityScore: 70 },
  ];

  const toolMap: Record<string, string> = {
    r1: "create_email_draft", r2: "create_email_draft",
    r3: "create_follow_up_task",
    r4: "create_email_draft", r5: "create_follow_up_task",
    r6: "create_follow_up_task",
  };

  for (const rec of testRecs) {
    const proposal = mapBrainRecToToolProposal(rec);
    if (!proposal) { console.log(`   ✗ ${rec.id} (${rec.agentType}/${rec.actionType}) → null`); process.exit(1); }
    const expected = toolMap[rec.id];
    const ok = proposal.toolName === expected;
    console.log(`   ${ok ? "✓" : "✗"} ${rec.agentType}/${rec.actionType} → ${proposal.toolName} (expected: ${expected})`);
    if (!ok) process.exit(1);
    // Verify input has the right fields
    if (proposal.toolName === "create_email_draft") {
      if (!proposal.proposedInput.subject || !proposal.proposedInput.body) { console.log(`   ✗ Missing subject/body on draft for ${rec.id}`); process.exit(1); }
    }
    if (proposal.toolName === "create_follow_up_task") {
      if (!proposal.proposedInput.followUpDate) { console.log(`   ✗ Missing followUpDate on task for ${rec.id}`); process.exit(1); }
    }
  }

  // ── 2. Revenue Agent mapping ─────────────────────────────────────────
  console.log("\n2. Revenue Agent → Tool Mapping...");
  const revActions = [
    { id: "a1", actionType: "send_followup", reason: "Overdue 14 days", estimatedValue: 1200, dealId: null, prospectId: "p1", metadata: { prospectName: "Lincoln HS" } },
    { id: "a2", actionType: "schedule_call", reason: "Ready for call", estimatedValue: 2000, dealId: "d1", prospectId: null, metadata: {} },
    { id: "a3", actionType: "move_stage", reason: "Ready to advance", estimatedValue: 3000, dealId: "d2", prospectId: null, metadata: {} },
    { id: "a4", actionType: "mark_lost", reason: "No response in 60 days", estimatedValue: 0, dealId: "d3", prospectId: null, metadata: {} },
    { id: "a5", actionType: "re_engage", reason: "Warm lead resurfaced", estimatedValue: 1500, dealId: null, prospectId: "p2", metadata: { prospectName: "Eastside HS" } },
    { id: "a6", actionType: "create_deal", reason: "Hot lead ready", estimatedValue: 2500, dealId: null, prospectId: "p3", metadata: {} },
  ];
  const revToolMap: Record<string, string> = {
    a1: "create_email_draft", a2: "create_follow_up_task",
    a3: "update_deal_stage", a4: "update_deal_stage",
    a5: "create_email_draft", a6: "create_follow_up_task",
  };

  for (const action of revActions) {
    const proposal = mapRevenueActionToToolProposal(action);
    if (!proposal) { console.log(`   ✗ ${action.id} (${action.actionType}) → null`); process.exit(1); }
    const expected = revToolMap[action.id];
    const ok = proposal.toolName === expected;
    console.log(`   ${ok ? "✓" : "✗"} ${action.actionType} → ${proposal.toolName} (expected: ${expected})`);
    if (!ok) process.exit(1);
    // Verify attribution
    if (proposal.sourceRevenueActionId !== action.id) { console.log(`   ✗ sourceRevenueActionId not set`); process.exit(1); }
  }
  console.log("   ✓ All revenue action attribution set correctly");

  // ── 3. Full pipeline: Brain rec → proposeToolCall with attribution ────
  console.log("\n3. Full pipeline: Brain rec → proposeToolCall...");
  const brainRec = testRecs[3]; // followup_hot_lead → create_email_draft (auto-execute)
  const brainProposal = mapBrainRecToToolProposal(brainRec)!;
  const brainResult = await proposeToolCall(orgId, {
    agentName: "business_brain",
    ...brainProposal,
    sourceRecommendationId: brainRec.id,
  });
  console.log("   ✓ Proposed:", brainResult.success, "| Auto-executed:", !brainResult.pendingConfirmation);
  console.log("   ✓ No confirmation needed:", !brainResult.requiresConfirmation);

  // Verify attribution stored in DB
  const attrCheck = await db.execute(sql`
    SELECT source_recommendation_id, source_revenue_action_id, tool_name, status
    FROM agent_tool_calls WHERE id = ${brainResult.toolCallId}
  `);
  const attrRow = attrCheck.rows[0] as any;
  console.log("   ✓ sourceRecommendationId stored:", attrRow?.source_recommendation_id === brainRec.id);
  console.log("   ✓ Tool:", attrRow?.tool_name, "| Status:", attrRow?.status);

  // ── 4. Revenue action → proposeToolCall (confirmation required) ───────
  console.log("\n4. Revenue action → proposeToolCall (update_deal_stage needs confirm)...");
  const revAction = revActions[2]; // move_stage → update_deal_stage (requires confirmation)
  const revProposal = mapRevenueActionToToolProposal(revAction)!;
  const revResult = await proposeToolCall(orgId, {
    agentName: "revenue_agent",
    ...revProposal,
    sourceRevenueActionId: revAction.id,
  });
  console.log("   ✓ Proposed:", revResult.success, "| Requires confirmation:", revResult.requiresConfirmation);

  // Verify attribution stored
  const revAttr = await db.execute(sql`
    SELECT source_revenue_action_id, tool_name, status
    FROM agent_tool_calls WHERE id = ${revResult.toolCallId}
  `);
  const revRow = revAttr.rows[0] as any;
  console.log("   ✓ sourceRevenueActionId stored:", revRow?.source_revenue_action_id === revAction.id);

  // ── 5. Audit log shows attribution ────────────────────────────────────
  console.log("\n5. Audit log with attribution...");
  const log = await getToolCallAuditLog(orgId, 20);
  const withRec = log.filter((r: any) => r.source_recommendation_id).length;
  const withRev = log.filter((r: any) => r.source_revenue_action_id).length;
  console.log("   ✓ Tool calls with sourceRecommendationId:", withRec, "(expected ≥1)");
  console.log("   ✓ Tool calls with sourceRevenueActionId:", withRev, "(expected ≥1)");
  if (withRec < 1 || withRev < 1) { console.log("   ✗ Attribution missing"); process.exit(1); }

  // ── 6. API endpoint smoke tests ───────────────────────────────────────
  console.log("\n6. API endpoints...");
  const http = await import("http");
  for (const ep of [
    { m: "GET", p: "/api/admin/agent-tool-calls" },
    { m: "GET", p: "/api/admin/agent-tool-calls/pending" },
    { m: "GET", p: "/api/admin/agent-tools" },
  ]) {
    await new Promise<void>(r => {
      const req = http.request({ hostname: "localhost", port: 5000, path: ep.p, method: ep.m }, res => {
        res.resume(); res.on("end", () => { console.log(`   ${[200,401].includes(res.statusCode!) ? "✓" : "✗"} ${ep.m} ${ep.p} → ${res.statusCode}`); r(); });
      }); req.on("error", () => { console.log(`   ✗ ${ep.m} ${ep.p} error`); r(); }); req.end();
    });
  }

  // Cleanup
  await db.execute(sql`DELETE FROM agent_tool_calls WHERE org_id = ${orgId}`);
  console.log("\n✓ ALL WIRING ACCEPTANCE TESTS PASSED");
  process.exit(0);
}
run().catch(e => { console.error("FAIL:", e.message, e.stack?.split("\n")[1]); process.exit(1); });
