/**
 * 示例:列出所有在线 agents
 * 跑法: cd examples/list_agents && npx tsx main.ts
 */

import { Client, PageOptions } from "wau-sdk";

async function main(): Promise<void> {
  const c = new Client("http://localhost:18400");
  try {
    const resp = await c.agents.list(new PageOptions({ page: 1, pageSize: 10 }));
    console.log(`在线 agents (${resp.agents.length}):`);
    for (const a of resp.agents) {
      console.log(`  - ${a.name}  trust=${a.trust.toFixed(2)}  status=${a.status}  skills=${a.skills.join(", ")}`);
    }
  } finally {
    await c.close();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
