/**
 * 二开 #27：代理出口检测。登录前 / 保存代理前先确认这条代理真的能用、
 * 而且出口 IP 不是 CPA 服务器自己的 IP，通过才放行。
 *
 * 做法：经 CPA `POST /requests/api-call` 访问 IP 回显地址两次（都不带 auth_index，
 * 不碰任何账号凭证）：
 *   1. 不带 proxy_url → CPA 服务器本机出口 IP（基准）；
 *   2. 带 proxy_url   → 这条代理的出口 IP。
 * 第 2 次失败 = 代理不通；两次 IP 相同 = 代理没生效（CPA 在代理地址建不起来时会
 * 静默直连，见 api_tools.go apiCallTransport），都拦截。
 */
import { apiCallApi } from '@/services/api/apiCall';
import { getErrorMessage, isRecord } from '@/utils/helpers';

export const PROXY_ECHO_URL = 'https://ipinfo.io/json';
const CHECK_TIMEOUT_MS = 20 * 1000;

export type ProxyCheckFailure =
  /** 格式不对：只接受 socks5:// 或 socks5h://，必须有主机和 1-65535 端口。 */
  | 'invalid'
  /** 拿不到服务器本机出口 IP，无法确认代理是否生效。 */
  | 'baseline_failed'
  /** 走这条代理访问失败（连不上、超时、认证失败等）。 */
  | 'unreachable'
  /** 回显内容里没有 IP。 */
  | 'bad_response'
  /** 代理出口 IP 与服务器本机相同 = 代理没生效。 */
  | 'same_ip';

export type ProxyCheckResult =
  | { ok: true; ip: string; location: string }
  | { ok: false; reason: ProxyCheckFailure; detail?: string };

/** 与 New API 的 ValidateSocksProxyURL 同口径。 */
export function isValidSocksProxyUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'socks5' && scheme !== 'socks5h') return false;
  if (!parsed.hostname || parsed.search || parsed.hash) return false;
  if (parsed.pathname && parsed.pathname !== '/') return false;
  // 端口必须显式写出；URL 不会给 socks 补默认端口，空串即没写。
  if (!/^\d+$/.test(parsed.port)) return false;
  const port = Number(parsed.port);
  return port >= 1 && port <= 65535;
}

type EchoResult = { ok: true; ip: string; location: string } | { ok: false; detail: string };

async function echoIp(proxyUrl?: string): Promise<EchoResult> {
  try {
    const result = await apiCallApi.request(
      {
        ...(proxyUrl ? { proxy_url: proxyUrl } : {}),
        method: 'GET',
        url: PROXY_ECHO_URL,
        header: { Accept: 'application/json' },
      },
      { timeout: CHECK_TIMEOUT_MS }
    );
    if (result.statusCode < 200 || result.statusCode >= 300) {
      return { ok: false, detail: `HTTP ${result.statusCode}` };
    }
    const body = result.body;
    const ip = isRecord(body) && typeof body.ip === 'string' ? body.ip.trim() : '';
    if (!ip) return { ok: false, detail: 'no ip in response' };
    const parts = isRecord(body) ? [body.country, body.city, body.org] : [];
    const location = parts
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(' · ');
    return { ok: true, ip, location };
  } catch (err: unknown) {
    return { ok: false, detail: getErrorMessage(err, 'request failed') };
  }
}

export async function checkProxyEgress(proxyUrl: string): Promise<ProxyCheckResult> {
  const proxy = proxyUrl.trim();
  if (!isValidSocksProxyUrl(proxy)) return { ok: false, reason: 'invalid' };

  const baseline = await echoIp();
  if (!baseline.ok) return { ok: false, reason: 'baseline_failed', detail: baseline.detail };

  const proxied = await echoIp(proxy);
  if (!proxied.ok) {
    const reason = proxied.detail === 'no ip in response' ? 'bad_response' : 'unreachable';
    return { ok: false, reason, detail: proxied.detail };
  }
  if (proxied.ip === baseline.ip) return { ok: false, reason: 'same_ip', detail: proxied.ip };
  return { ok: true, ip: proxied.ip, location: proxied.location };
}

/** 失败原因 → i18n key（auth_login 下）。 */
export const proxyCheckFailureKey = (reason: ProxyCheckFailure) =>
  `auth_login.proxy_check_${reason}`;
