/**
 * 示例:提交 L4 任务(真发 A2A)
 * 跑法: cd examples/submit_task && npx tsx main.ts "What is the capital of France?"
 */

import { Client, SubmitRequest } from "wau-sdk";

async function main(): Promise<void> {
  const prompt = process.argv[2] ?? "What is the capital of France?";

  const c = new Client("http://localhost:18400");
  try {
    const resp = await c.tasks.submit(new SubmitRequest(prompt, 30000));
    console.log(`✅ 状态: ${resp.status}`);
    console.log(`🤖 选中 agent: ${resp.selectedAgent} (score=${resp.score.toFixed(2)})`);
    console.log(`📊 L3 决策: ${resp.decision.decision_time_ms}ms | A2A 调用: ${resp.a2a_call_ms}ms`);
    console.log(`💬 响应: ${resp.response}`);
  } finally {
    await c.close();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
