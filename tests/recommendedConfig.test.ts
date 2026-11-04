import { describe, expect, test } from 'bun:test';
import {
  RECOMMENDED_RULES,
  buildRecommendedPatch,
  buildUndoEntries,
  checkRules,
  checkSafety,
  countPending,
  splitUndo,
} from '../src/features/recommendedConfig/rules';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ko from '../src/i18n/locales/ko.json';
import ru from '../src/i18n/locales/ru.json';
import tr from '../src/i18n/locales/tr.json';
import vi from '../src/i18n/locales/vi.json';

const ALL_RECOMMENDED = {
  management: {
    'disable-auto-update-panel': true,
    'disable-control-panel': false,
    'secret-key': 'x',
  },
  routing: {
    'session-affinity': true,
    'session-affinity-ttl': '1h',
    'session-affinity-rebind-on': 'any',
  },
  observability: {
    usage: { 'usage-statistics-enabled': true, 'redis-usage-queue-retention-seconds': 1800 },
    logs: { 'logs-max-total-size-mb': 500 },
  },
  requests: {
    'tls-handshake-timeout-seconds': 15,
    streaming: { 'keepalive-seconds': 15, 'bootstrap-retries': 1 },
  },
  upstream: { claude: { 'model-level-cooling': true } },
  server: { host: '127.0.0.1' },
};

describe('recommended config rules', () => {
  test('empty config: unset fields fall back to CPA defaults', () => {
    const results = checkRules({});
    const byId = Object.fromEntries(results.map((r) => [r.rule.id, r.ok]));
    // 默认值本身就等于推荐值的项
    expect(byId.disable_control_panel).toBe(true);
    expect(byId.session_affinity_ttl).toBe(true);
    expect(byId.session_affinity_rebind_on).toBe(true);
    expect(countPending({})).toBe(RECOMMENDED_RULES.length - 3);
  });

  test('fully recommended config has nothing pending', () => {
    expect(countPending(ALL_RECOMMENDED)).toBe(0);
  });

  test('patch only contains selected fields', () => {
    expect(buildRecommendedPatch(['session_affinity', 'claude_model_level_cooling'])).toEqual({
      routing: { 'session-affinity': true },
      upstream: { claude: { 'model-level-cooling': true } },
    });
    expect(buildRecommendedPatch([])).toEqual({});
  });

  test('undo restores original values and deletes fields that were unset', () => {
    const config = { routing: { 'session-affinity': false } };
    const undo = buildUndoEntries(config, ['session_affinity', 'tls_handshake_timeout']);
    expect(splitUndo(undo)).toEqual({
      patch: { routing: { 'session-affinity': false } },
      deletions: [['requests', 'tls-handshake-timeout-seconds']],
    });
  });

  test('safety checks only report, never patch', () => {
    const levels = Object.fromEntries(
      checkSafety({ requests: { 'proxy-url': 'socks5://x' }, server: { host: '0.0.0.0' } }).map(
        (s) => [s.id, s.level]
      )
    );
    expect(levels).toEqual({
      secret_key: 'warn',
      proxy_url: 'warn',
      server_host: 'info',
      request_log: 'ok',
      debug: 'ok',
      pprof: 'ok',
    });
  });

  test('every locale has all rule and safety texts', () => {
    type Texts = { title?: string; desc?: string; ok?: string; tip?: string };
    type LocaleShape = {
      nav: Record<string, string>;
      nav_meta: Record<string, string>;
      recommended_config: { rules: Record<string, Texts>; safety: Record<string, Texts> };
    };
    for (const locale of [en, zhCN, zhTW, ko, ru, tr, vi] as unknown as LocaleShape[]) {
      const block = locale.recommended_config;
      expect(locale.nav.recommended_config).toBeTruthy();
      expect(locale.nav_meta.recommended_config).toBeTruthy();
      for (const rule of RECOMMENDED_RULES) {
        expect(block.rules[rule.id].title).toBeTruthy();
        expect(block.rules[rule.id].desc).toBeTruthy();
      }
      for (const item of checkSafety({})) {
        expect(block.safety[item.id].title).toBeTruthy();
        expect(block.safety[item.id].ok).toBeTruthy();
        expect(block.safety[item.id].tip).toBeTruthy();
      }
    }
  });
});
