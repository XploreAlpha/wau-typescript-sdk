/**
 * 示例:跑 5 场景契约(对齐 wau-go-sdk + wau-python-sdk 同名 examples)
 * 跑法: cd examples/five_scenarios && npx tsx main.ts
 */

import { Client, SubmitRequest } from "wau-sdk";

const SCENARIOS: Array<[string, string, string, string[]]> = [
  ["clinical", "I need clinical decision support for a patient", "Jarvis",
    ["临床", "决策", "支持", "患者"]],
  ["france", "What is the capital of France?", "Whis", ["paris"]],
  ["pain", "Recommend an over-the-counter pain reliever", "Benny",
    ["ibuprofen", "acetaminophen"]],
  ["sales", "Show me this quarter's sales analytics", "Whis",
    ["sales", "analytics", "quarter"]],
  ["rare_disease", "Help me diagnose a rare disease", "Jarvis",
    ["罕见病", "鉴别", "诊断"]],
];

async function main(): Promise<void> {
  const c = new Client("http://localhost:18400");
  let pass = 0, fail = 0;
  try {
    for (const [scene, prompt, expectedAgent, expectedTokens] of SCENARIOS) {
      console.log(`\n=== ${scene} ===`);
      console.log(`Prompt: ${prompt}`);
      try {
        const resp = await c.tasks.submit(new SubmitRequest(prompt, 60000));
        if (resp.status !== "completed") {
          console.log(`   ❌ status=${resp.status} err=${resp.error}`);
          fail++;
          continue;
        }
        if (resp.selectedAgent !== expectedAgent) {
          console.log(`   ❌ 选了 ${resp.selectedAgent} (期望 ${expectedAgent})`);
          fail++;
          continue;
        }
        const text = String(resp.response ?? "").toLowerCase();
        const matched = expectedTokens.some((t) => text.includes(t.toLowerCase()));
        if (!matched) {
          console.log(`   ❌ 响应里没找到期望 token`);
          fail++;
          continue;
        }
        console.log(`   ✅ → ${resp.selectedAgent}  L3=${resp.decision.decision_time_ms}ms A2A=${resp.a2a_call_ms}ms`);
        pass++;
      } catch (err) {
        console.log(`   ❌ HTTP error: ${err}`);
        fail++;
      }
    }
    console.log(`\n=== 汇总: ${pass}/${SCENARIOS.length} 通过 ===`);
    process.exit(fail === 0 ? 0 : 1);
  } finally {
    await c.close();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
