/**
 * OAuth and device-code login API
 */

import { apiClient } from './client';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';

export type BuiltInOAuthProvider =
  'codex' | 'anthropic' | 'antigravity' | 'kimi' | 'kimi-ai' | 'xai' | 'devin' | 'meta';

export interface OAuthStartResponse {
  url: string;
  state?: string;
  user_code?: string;
  flow?: string;
  expires_in?: number;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface OAuthCancelResponse {
  status: 'ok';
  cancelled: boolean;
}

const WEBUI_SUPPORTED = new Set<string>(['codex', 'claude', 'antigravity', 'xai', 'devin']);

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key === 'anthropic' ? 'claude' : key;
};

export interface SiwcBindResponse {
  status: 'ok';
  url: string;
  state: string;
  flow: 'siwc_bind';
  expires_in: number;
}

export const oauthApi = {
  startSiwcBind: (name: string, signal?: AbortSignal) =>
    apiClient.post<SiwcBindResponse>('/oauth/siwc/bind', { name }, signal ? { signal } : undefined),

  /**
   * 二开：GET+query 改为 POST+body。后端只认 body 里的 proxy_url（query 里的会被忽略）。
   * proxyUrl 非必填：留空/全空白时不发该字段（空串会走 ModeInherit，语义不干净），即全程直连；
   * 填了则该会话的 授权→兑换→调用→刷新 全程走同一条代理。
   */
  startAuth: (provider: string, proxyUrl?: string, signal?: AbortSignal) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const body: Record<string, string | boolean> = { provider: providerKey };
    if (WEBUI_SUPPORTED.has(providerKey)) {
      body.is_webui = true;
    }
    const proxy = (proxyUrl ?? '').trim();
    if (proxy) {
      body.proxy_url = proxy;
    }
    return apiClient.post<OAuthStartResponse>(
      '/oauth/auth-url',
      body,
      signal ? { signal } : undefined
    );
  },

  getAuthStatus: (state: string, signal?: AbortSignal) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/oauth/status`, {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  cancelSession: (state: string, signal?: AbortSignal) =>
    apiClient.delete<OAuthCancelResponse>('/oauth/session', {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  submitCallback: (provider: string, redirectUrl: string, signal?: AbortSignal) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    return apiClient.post<OAuthCallbackResponse>(
      '/oauth/callback',
      { provider: providerKey, redirect_url: redirectUrl },
      signal ? { signal } : undefined
    );
  },
};

/** Start and cleanup must use the same connection, even after the dialog closes. */
export function captureSiwcBindingApi() {
  const client = apiClient.captureConnection();
  return {
    start: (name: string) => client.post<SiwcBindResponse>('/oauth/siwc/bind', { name }),
    cancel: (state: string) => client.delete('/oauth/session', { params: { state } }),
  };
}
