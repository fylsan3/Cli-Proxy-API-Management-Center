import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import {
  checkProxyEgress,
  isValidSocksProxyUrl,
  PROXY_ECHO_URL,
} from '@/features/oauth/proxyEgressCheck';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

/** 按请求是否带 proxy_url 返回不同的回显结果。 */
const mockEcho = (direct: unknown, proxied: unknown) => {
  const post = spyOn(apiClient, 'post').mockImplementation((async (
    _url: string,
    payload: { proxy_url?: string }
  ) => {
    const value = payload.proxy_url ? proxied : direct;
    if (value instanceof Error) throw value;
    return value;
  }) as never);
  spies.push(post);
  return post;
};
const echo = (ip: string) => ({ status_code: 200, body: JSON.stringify({ ip, country: 'JP' }) });

describe('#27 proxy egress check', () => {
  test('accepts only socks5/socks5h with host and explicit port', () => {
    for (const ok of ['socks5h://1.2.3.4:1080', 'socks5://u:p@host.example:65535/']) {
      expect(isValidSocksProxyUrl(ok)).toBe(true);
    }
    for (const bad of [
      '',
      'sock5://1.2.3.4:1080',
      'http://1.2.3.4:8080',
      'socks5h://1.2.3.4',
      'socks5h://:1080',
      'socks5h://1.2.3.4:0',
      'socks5h://1.2.3.4:1080/path',
      'socks5h://1.2.3.4:1080?x=1',
      'direct',
    ]) {
      expect(isValidSocksProxyUrl(bad)).toBe(false);
    }
  });

  test('invalid format is blocked without any request', async () => {
    const post = mockEcho(echo('9.9.9.9'), echo('1.1.1.1'));
    expect(await checkProxyEgress('sock5://1.2.3.4:1080')).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(post).not.toHaveBeenCalled();
  });

  test('passes when proxied IP differs from server IP; never sends auth_index', async () => {
    const post = mockEcho(echo('9.9.9.9'), echo('1.1.1.1'));
    const result = await checkProxyEgress(' socks5h://1.2.3.4:1080 ');
    expect(result).toEqual({ ok: true, ip: '1.1.1.1', location: 'JP' });
    expect(post).toHaveBeenCalledTimes(2);
    const payloads = post.mock.calls.map((call) => call[1] as Record<string, unknown>);
    expect(payloads[0]).toEqual({
      method: 'GET',
      url: PROXY_ECHO_URL,
      header: { Accept: 'application/json' },
    });
    expect(payloads[1].proxy_url).toBe('socks5h://1.2.3.4:1080');
    for (const payload of payloads) expect(payload.authIndex).toBeUndefined();
  });

  test('same IP means CPA silently went direct → blocked', async () => {
    mockEcho(echo('9.9.9.9'), echo('9.9.9.9'));
    expect(await checkProxyEgress('socks5h://1.2.3.4:1080')).toMatchObject({
      ok: false,
      reason: 'same_ip',
    });
  });

  test('proxy failure (CPA 502) → unreachable', async () => {
    mockEcho(echo('9.9.9.9'), new Error('request failed'));
    expect(await checkProxyEgress('socks5h://1.2.3.4:1080')).toMatchObject({
      ok: false,
      reason: 'unreachable',
    });
  });

  test('upstream non-2xx through proxy → unreachable', async () => {
    mockEcho(echo('9.9.9.9'), { status_code: 407, body: '' });
    expect(await checkProxyEgress('socks5h://1.2.3.4:1080')).toMatchObject({
      ok: false,
      reason: 'unreachable',
    });
  });

  test('no baseline IP → cannot verify → blocked', async () => {
    mockEcho(new Error('timeout'), echo('1.1.1.1'));
    expect(await checkProxyEgress('socks5h://1.2.3.4:1080')).toMatchObject({
      ok: false,
      reason: 'baseline_failed',
    });
  });

  test('echo without ip → bad_response', async () => {
    mockEcho(echo('9.9.9.9'), { status_code: 200, body: '{"hello":1}' });
    expect(await checkProxyEgress('socks5h://1.2.3.4:1080')).toMatchObject({
      ok: false,
      reason: 'bad_response',
    });
  });
});
