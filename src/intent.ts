/**
 * IntentService — M3.1 gRPC stub(对齐 wau-go-sdk intent.go)
 *
 * v0.6.0 M3 W6.5-7: P2 stub, 所有方法抛 NotImplementedError
 * v0.6.0 M3.1: 实装 wau.intent.v1.IntentService 4 RPC
 *   (ParseIntent/RecommendAgent/ListAgents/HealthCheck)
 */

import { NotImplementedError } from "./errors";

export class IntentService {
  /**
   * 推荐 agent (P2 stub)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async recommend(prompt: string, topK: number = 1): Promise<unknown> {
    void prompt;
    void topK;
    throw new NotImplementedError("IntentService.recommend: P2 gRPC stub, M3.1 实装");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async parseIntent(text: string): Promise<unknown> {
    void text;
    throw new NotImplementedError("IntentService.parseIntent: P2 gRPC stub, M3.1 实装");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listAgents(onlineOnly: boolean = true): Promise<unknown> {
    void onlineOnly;
    throw new NotImplementedError("IntentService.listAgents: P2 gRPC stub, M3.1 实装");
  }

  async healthCheck(): Promise<unknown> {
    throw new NotImplementedError("IntentService.healthCheck: P2 gRPC stub, M3.1 实装");
  }
}
