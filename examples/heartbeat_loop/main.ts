/**
 * 示例:agent 端定时心跳上报
 * 跑法: cd examples/heartbeat_loop && npx tsx main.ts my-agent
 */

import { Client, AgentLoad } from "wau-sdk";

const AGENT_NAME = process.argv[2] ?? "demo-agent";

function now(): string {
  return new Date().toISOString().substring(11, 19);
}

async function doHeartbeat(c: Client): Promise<void> {
  try {
    await c.agents.heartbeat(AGENT_NAME);
    await c.agents.reportLoad(AGENT_NAME, new AgentLoad({
      activeTasks: 0, maxCapacity: 10, cpuUsage: 0.1, memoryUsage: 0.2,
    }));
    console.log(`[${now()}] 💓 heartbeat ok`);
  } catch (err) {
    console.error(`[${now()}] ❌ heartbeat: ${err}`);
  }
}

async function main(): Promise<void> {
  const c = new Client("http://localhost:18400");
  try {
    // 注册 agent
    await c.agents.register({
      name: AGENT_NAME,
      url: `http://${AGENT_NAME}:18800`,
      description: "demo agent for heartbeat example",
      skills: ["demo", "test"],
    });
    console.log(`✅ Agent '${AGENT_NAME}' 已注册`);

    // 立即跑一次
    await doHeartbeat(c);

    // 60s 循环
    setInterval(() => doHeartbeat(c), 60_000);

    // Ctrl+C 处理
    process.on("SIGINT", async () => {
      console.log("\n[退出...]");
      await c.close();
      process.exit(0);
    });
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
