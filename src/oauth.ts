/**
 * OAuth 2.0 Client Credentials flow(2026-07-10 M2 OAuth Day 4)
 *
 * 对齐 wau-go-sdk/oauth.go + wau-python-sdk/_oauth.py:
 *   - OAuthClient.clientCredentials() 走 RFC 6749 §4.4 Client Credentials grant
 *   - RefreshableTokenStore 自动 refresh(过期前 30s)
 *
 * 0 改动既有 client.ts / transport.ts / auth.ts / options.ts
 * 本文件独立,新增 OAuth 子模块,B 端 SDK 程序化拿 token 用。
 */

export interface OAuthConfig {
  endpoint: string;        // /oauth/token URL
  clientId: string;        // 必填
  clientSecret: string;    // 必填
  scope?: string;          // 可选(空格分隔)
  refreshSkewSeconds?: number; // 提前 refresh(默认 30)
  fetchImpl?: typeof fetch; // 可选注入(测试用)
}

interface TokenPair {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * RefreshableTokenStore 持有 access + refresh,过期前自动 refresh。
 * 线程安全:用 in-flight 锁避免并发 refresh。
 */
export class RefreshableTokenStore {
  private access: string;
  private refresh: string;
  private expiresAt: number;
  private inflightRefresh: Promise<void> | null = null;
  private readonly oc: OAuthClient;

  constructor(pair: TokenPair, oc: OAuthClient) {
    this.oc = oc;
    this.access = pair.access_token;
    this.refresh = pair.refresh_token || "";
    this.expiresAt = Date.now() + pair.expires_in * 1000;
  }

  async token(): Promise<string> {
    if (Date.now() + this.oc.skewMs() < this.expiresAt) {
      return this.access;
    }
    await this.refreshAccessToken();
    return this.access;
  }

  async authorizationHeader(): Promise<string> {
    return `Bearer ${await this.token()}`;
  }

  get expiresAtValue(): number {
    return this.expiresAt;
  }

  private async refreshAccessToken(): Promise<void> {
    if (this.inflightRefresh) {
      return this.inflightRefresh;
    }
    const refresh = this.refresh;
    const endpoint = this.oc.cfg.endpoint;
    const cfg = this.oc.cfg;

    this.inflightRefresh = (async () => {
      try {
        const form = new URLSearchParams();
        if (refresh) {
          form.set("grant_type", "refresh_token");
          form.set("refresh_token", refresh);
          form.set("client_id", cfg.clientId);
          form.set("client_secret", cfg.clientSecret);
        } else {
          form.set("grant_type", "client_credentials");
          form.set("client_id", cfg.clientId);
          form.set("client_secret", cfg.clientSecret);
          if (cfg.scope) form.set("scope", cfg.scope);
        }

        const resp = await this.oc.fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
        if (!resp.ok) {
          throw new Error(`wau: oauth refresh HTTP ${resp.status}: ${await resp.text()}`);
        }
        const data: TokenPair = await resp.json();
        this.access = data.access_token;
        if (data.refresh_token) this.refresh = data.refresh_token;
        if (data.expires_in) {
          this.expiresAt = Date.now() + data.expires_in * 1000;
        }
      } finally {
        // 双检:如果 refresh 后还没到过期点,直接 return;否则下次再 refresh
        if (Date.now() + this.oc.skewMs() >= this.expiresAt) {
          // still expired → leave for next call
        }
        this.inflightRefresh = null;
      }
    })();

    return this.inflightRefresh;
  }
}

/**
 * OAuth 2.0 Client Credentials 客户端(B 端 SDK 走这个)
 *
 * 用法:
 *   const oc = new OAuthClient({
 *     endpoint: "http://localhost:18400/oauth/token",
 *     clientId: "wau-sdk-law-zhang",
 *     clientSecret: "...",
 *     scope: "read:agents write:agents",
 *   });
 *   const store = await oc.clientCredentials();
 *   const hdr = await store.authorizationHeader();
 */
export class OAuthClient {
  readonly cfg: OAuthConfig;
  private readonly _fetch: typeof fetch;

  constructor(cfg: OAuthConfig) {
    if (!cfg.clientId) throw new Error("wau: oauth clientId is required");
    if (!cfg.clientSecret) throw new Error("wau: oauth clientSecret is required");
    if (!cfg.endpoint) throw new Error("wau: oauth endpoint is required");
    this.cfg = cfg;
    this._fetch = cfg.fetchImpl || fetch;
  }

  skewMs(): number {
    return (this.cfg.refreshSkewSeconds ?? 30) * 1000;
  }

  get fetch(): typeof fetch {
    return this._fetch;
  }

  async clientCredentials(): Promise<RefreshableTokenStore> {
    const form = new URLSearchParams();
    form.set("grant_type", "client_credentials");
    form.set("client_id", this.cfg.clientId);
    form.set("client_secret", this.cfg.clientSecret);
    if (this.cfg.scope) form.set("scope", this.cfg.scope);

    const resp = await this._fetch(this.cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!resp.ok) {
      throw new Error(`wau: oauth HTTP ${resp.status}: ${await resp.text()}`);
    }
    const data: TokenPair = await resp.json();
    if (!data.access_token) {
      throw new Error("wau: oauth empty access_token in response");
    }
    return new RefreshableTokenStore(data, this);
  }
}
// ============================================================================
// v1.0.0 M4 OAuth 增强 (2026-07-08):Refresh 公开方法 + PKCE
// 设计(per M4 拍板 2.1=A Server side + 2.2=A Rotate + 2.3=A 4 SDK 都加):
//   - refreshToken() 公开方法:caller 显式触发 refresh
//   - currentPair() 返 TokenPair(给 caller 持久化)
//   - PKCEClient:Authorization Code + PKCE(per RFC 7636)
//   - 0 改老 OAuthClient + RefreshableTokenStore(D60 additive)
// ============================================================================

// 在 RefreshableTokenStore prototype 上加 public 方法(D60 安全:不动原类体)
// 实际做法:用 module augmentation 或重新 open class
// TypeScript 不支持直接 monkey-patch,改用 declare merging
declare module "./oauth" {
  interface RefreshableTokenStore {
    /** v1.0.0 M4 — 显式触发 refresh,不等 token() lazy。 */
    refreshToken(): Promise<void>;
    /** v1.0.0 M4 — 返当前 token pair(明文,谨慎使用)。 */
    currentPair(): TokenPair;
  }
}

// 实现 patch(用 prototype 注入,保留类型)
(RefreshableTokenStore as any).prototype.refreshToken = async function (this: any): Promise<void> {
  await this.refreshAccessToken();
};
(RefreshableTokenStore as any).prototype.currentPair = function (this: any): TokenPair {
  return {
    access_token: this.access,
    token_type: "Bearer",
    expires_in: Math.floor((this.expiresAt - Date.now()) / 1000),
    refresh_token: this.refresh,
  };
};

/** v1.0.0 M4 — 公开 token pair(给 caller 持久化用) */
export interface PublicTokenPair {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

// ---------------------- PKCE(per RFC 7636) ----------------------

/** v1.0.0 M4 — PKCE 配置。公共 client(无 client_secret)用这个走 Auth Code flow。 */
export interface PKCEConfig {
  authEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
}

/** v1.0.0 M4 — PKCE code_verifier + code_challenge(S256) */
export interface PKCEChallenge {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** v1.0.0 M4 — 生成 PKCE challenge */
export async function generatePKCEChallenge(): Promise<PKCEChallenge> {
  // 32 bytes → 43 字符 base64url no padding
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = btoa(String.fromCharCode(...verifierBytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // S256:challenge = base64url(sha256(verifier))
  const challengeBytes = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", challengeBytes);
  const hashArr = new Uint8Array(hashBuffer);
  const challenge = btoa(String.fromCharCode(...hashArr))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return { verifier, challenge, method: "S256" };
}

/** v1.0.0 M4 — Authorization Code + PKCE 客户端(per OAuth 2.0 + RFC 7636) */
export class PKCEClient {
  constructor(private readonly cfg: PKCEConfig, private readonly _fetch: typeof fetch = fetch) {
    if (!cfg.authEndpoint) throw new Error("wau: PKCE authEndpoint is required");
    if (!cfg.tokenEndpoint) throw new Error("wau: PKCE tokenEndpoint is required");
    if (!cfg.clientId) throw new Error("wau: PKCE clientId is required");
    if (!cfg.redirectUri) throw new Error("wau: PKCE redirectUri is required");
  }

  /** 构造 authorize URL(用户浏览器打开) */
  authorizationURL(state: string, challenge: PKCEChallenge): string {
    const params = new URLSearchParams();
    params.set("response_type", "code");
    params.set("client_id", this.cfg.clientId);
    params.set("redirect_uri", this.cfg.redirectUri);
    params.set("scope", this.cfg.scopes.join(" "));
    params.set("state", state);
    params.set("code_challenge", challenge.challenge);
    params.set("code_challenge_method", challenge.method);
    return `${this.cfg.authEndpoint}?${params.toString()}`;
  }

  /** 用 authorization code + code_verifier 换 token pair(per RFC 6749 §4.1.3 + RFC 7636 §4.5) */
  async exchangeCode(code: string, verifier: string): Promise<RefreshableTokenStore> {
    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("code", code);
    form.set("redirect_uri", this.cfg.redirectUri);
    form.set("client_id", this.cfg.clientId);
    form.set("code_verifier", verifier);

    const resp = await this._fetch(this.cfg.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!resp.ok) {
      throw new Error(`wau: PKCE exchange HTTP ${resp.status}: ${await resp.text()}`);
    }
    const data: TokenPair = await resp.json();
    if (!data.access_token) {
      throw new Error("wau: PKCE exchange empty access_token");
    }
    // PKCE 路径:用 dummy OAuthClient(公共 client 无 secret)
    // store 不会有 refresh 调用直到 token 过期(那 caller 需重新 exchange_code)
    const dummyOC = new OAuthClient({
      endpoint: this.cfg.tokenEndpoint,
      clientId: this.cfg.clientId,
      clientSecret: "public-client-no-secret", // 兜底,RefreshableTokenStore 要求非空
      fetchImpl: this._fetch,
    });
    return new RefreshableTokenStore(data, dummyOC);
  }
}
