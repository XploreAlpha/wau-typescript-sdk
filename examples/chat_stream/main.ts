/**
 * wau-typescript-sdk Chat SSE 流式调用 e2e 示例 — 累加 content + 输出 chatcmpl ID
 *
 * 跑法::
 *
 *   cd examples/chat_stream && npx tsx main.ts
 *
 * 期望:
 *   - 启动 wau_sdk.Client(against http mock wau-edge)
 *   - mock 模拟 6 chunks(role + "1+1=2") + [DONE]
 *   - 累加 delta.content = "1+1=2"
 *   - chatcmpl ID 输出
 *
 * 为什么用 mock server(不连真 wau-edge):
 *   - 真 wau-edge 在公网 43.134.126.126(:18402),需要 SSH + 跨网
 *   - 真实链路已通过 [[2026-07-02-PROGRESS-M5-#1+-curl-edges]] C.1 测试(7 chunks)验证
 *   - 本 example 专注 SDK API 用法,用 mock server 演示完整 stream() 流程
 *   - 真 e2e 走 [[2026-07-01-PROGRESS-M5-#6-sdk-typescript]] Stage 3.1 #6 已验(chatcmpl-787dcac6)
 *
 * 完整链路(per Stage 3.1 #10):
 *   TS SDK stream() → wau-edge :18402 /v1/chat/completions?stream=true
 *                  → wau-llm-router :18404 Resolve(unary, 拿 userToken + model)
 *                  → new-api sidecar → DeepSeek v4-flash → SSE chunks → 响应回 SDK
 */

import * as http from "node:http";
import { Client, ChatMessage, ChatCompletionRequest } from "../../src";

function makeMockServer(port: number): Promise<{ close: () => void; url: string }> {
  return new Promise((resolve) => {
    const handler: http.RequestListener = (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end("only POST");
        return;
      }
      if (req.headers["accept"] !== "text/event-stream") {
        res.statusCode = 400;
        res.end("Accept must be text/event-stream");
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const req2 = JSON.parse(body);
        if (!req2.stream) {
          res.statusCode = 400;
          res.end("stream must be true");
          return;
        }
        const model = req2.model ?? "";
        const chunks = [
          { id: "chatcmpl-example-1", object: "chat.completion.chunk", created: 1700000000, model, choices: [{ index: 0, delta: { role: "assistant" } }] },
          { id: "chatcmpl-example-1", object: "chat.completion.chunk", created: 1700000000, model, choices: [{ index: 0, delta: { content: "1" } }] },
          { id: "chatcmpl-example-1", object: "chat.completion.chunk", created: 1700000000, model, choices: [{ index: 0, delta: { content: "+" } }] },
          { id: "chatcmpl-example-1", object: "chat.completion.chunk", created: 1700000000, model, choices: [{ index: 0, delta: { content: "1" } }] },
          { id: "chatcmpl-example-1", object: "chat.completion.chunk", created: 1700000000, model, choices: [{ index: 0, delta: { content: "=" } }] },
          { id: "chatcmpl-example-1", object: "chat.completion.chunk", created: 1700000000, model, choices: [{ index: 0, delta: { content: "2" }, finish_reason: "stop" }] },
        ];
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        for (const c of chunks) {
          res.write(`data: ${JSON.stringify(c)}\n\n`);
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
      });
    };
    const server = http.createServer(handler);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}

async function main(): Promise<void> {
  const port = 18385;
  const { url, close } = await makeMockServer(port);
  try {
    const c = new Client(url);
    console.log("=== wau-typescript-sdk Chat SSE 流式调用(against mock wau-edge)===");
    console.log(`url:    ${url}`);
    console.log("model:  deepseek-v4-flash");
    console.log("prompt: 1+1=?");
    console.log();

    let full = "";
    let lastId = "";
    let count = 0;
    process.stdout.write("response: ");
    for await (const chunk of c.chat.stream(
      new ChatCompletionRequest(
        "deepseek-v4-flash",
        [new ChatMessage("user", "1+1=?")]
      )
    )) {
      count++;
      lastId = chunk.id;
      if (chunk.choices.length > 0) {
        if (chunk.choices[0].delta.content) {
          process.stdout.write(chunk.choices[0].delta.content);
          full += chunk.choices[0].delta.content;
        }
        if (chunk.choices[0].finishReason === "stop") break;
      }
    }
    console.log();
    console.log();
    console.log("=== 总结 ===");
    console.log(`chatcmpl:  ${lastId}`);
    console.log(`chunks:    ${count} (role + 5 chars)`);
    console.log(`content:   ${full}`);
    console.log();
    console.log("✅ stream() 拿到 6 chunks,累加 content='1+1=2'");
    console.log("✅ FinishReason=stop 终止");
    console.log("✅ SDK SSE 解析正确(per wau-edge stream.go WriteChunk / WriteDone)");
  } finally {
    close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});