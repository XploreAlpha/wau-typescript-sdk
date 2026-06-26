/**
 * v0.8.0 M5-1 B.1 — HandshakeService
 *
 * 对应 kernel 端点(per WAU-core-kernel/cmd/wau-core/handle_handshake.go):
 *   - POST /v0.8.0/handshake/sessions
 *   - GET  /v0.8.0/handshake/sessions/{session_id}?tenant_id=xxx
 *   - GET  /admin/handshake/stats
 *
 * DTO 字段 1:1 对齐 kernel internal/handshake/session.go:92-142。
 * 错误码 9 个走 errors.ts 新增 Handshake*Error 类。
 */

import { Transport } from "./transport";
import {
  HandshakeRequest,
  HandshakeResponse,
  HandshakeSessionDetail,
  HandshakeStats,
} from "./types";

export class HandshakeService {
  constructor(
    private readonly transport: Transport,
    private readonly userAgent: string
  ) {}

  /**
   * POST /v0.8.0/handshake/sessions
   * clientId 不传时自动用 SDK user_agent。
   */
  async createSession(req: HandshakeRequest): Promise<HandshakeResponse> {
    const body: Record<string, string> = {
      tenant_id: req.tenantId,
      client_id: req.clientId || this.userAgent,
      agent_id: req.agentId,
      protocol: req.protocol,
    };
    if (req.universe) body.universe = req.universe;

    const data = (await this.transport.request(
      "POST",
      "/v0.8.0/handshake/sessions",
      body
    )) as {
      session_id: string;
      direct_endpoint: string;
      protocol: string;
      expires_at: string;
      ttl_seconds: number;
      reused: boolean;
    };
    return new HandshakeResponse(
      data.session_id,
      data.direct_endpoint,
      data.protocol,
      data.expires_at,
      data.ttl_seconds,
      data.reused
    );
  }

  /**
   * GET /v0.8.0/handshake/sessions/{session_id}?tenant_id=xxx
   * tenantId 必须传,用于跨 tenant 防护。
   */
  async getSession(sessionId: string, tenantId: string): Promise<HandshakeSessionDetail> {
    if (!tenantId) {
      throw new Error("tenantId is required for getSession");
    }
    const data = (await this.transport.request(
      "GET",
      `/v0.8.0/handshake/sessions/${sessionId}`,
      undefined,
      { tenant_id: tenantId }
    )) as {
      session_id: string;
      tenant_id: string;
      client_id: string;
      agent_id: string;
      direct_endpoint: string;
      protocol: string;
      trust_score: number;
      created_at: string;
      expires_at: string;
      ttl_seconds: number;
      reuse_count: number;
    };
    return new HandshakeSessionDetail(
      data.session_id,
      data.tenant_id,
      data.client_id,
      data.agent_id,
      data.direct_endpoint,
      data.protocol,
      data.trust_score,
      data.created_at,
      data.expires_at,
      data.ttl_seconds,
      data.reuse_count
    );
  }

  /** GET /admin/handshake/stats — hit rate 监控 */
  async getStats(): Promise<HandshakeStats> {
    const data = (await this.transport.request(
      "GET",
      "/admin/handshake/stats"
    )) as {
      total_sessions: number;
      total_reuses: number;
      reuse_hit_rate: number;
      active_sessions: number;
      per_tenant?: Record<string, { sessions: number; reuses: number; hit_rate: number }>;
    };
    const perTenant: Record<string, { sessions: number; reuses: number; hitRate: number }> = {};
    if (data.per_tenant) {
      for (const [k, v] of Object.entries(data.per_tenant)) {
        perTenant[k] = { sessions: v.sessions, reuses: v.reuses, hitRate: v.hit_rate };
      }
    }
    return new HandshakeStats(
      data.total_sessions,
      data.total_reuses,
      data.reuse_hit_rate,
      data.active_sessions,
      perTenant
    );
  }
}
