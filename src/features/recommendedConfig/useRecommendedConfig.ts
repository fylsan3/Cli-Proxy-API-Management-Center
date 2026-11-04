/**
 * 二开：推荐参数 —— 数据读取、应用、备份与还原。
 * 只使用 CPA 已有管理接口：GET /config、PATCH /config、DELETE /config/<path>、GET /config.yaml。
 */

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { configFileApi } from '@/services/api/configFile';
import { useAuthStore, useConfigStore } from '@/stores';
import {
  buildRecommendedPatch,
  buildUndoEntries,
  countPending,
  splitUndo,
  type ConfigScalar,
  type UndoEntry,
} from './rules';

export const RECOMMENDED_CONFIG_CHANGED_EVENT = 'recommended-config-changed';
const BACKUP_STORAGE_KEY = 'recommended-config:last-backup';

export interface RecommendedBackup {
  createdAt: string;
  apiBase: string;
  yaml: string;
  undo: UndoEntry[];
}

export async function fetchRawConfig(): Promise<unknown> {
  return apiClient.get('/config');
}

export function readBackup(apiBase: string): RecommendedBackup | null {
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecommendedBackup;
    if (!parsed || parsed.apiBase !== apiBase || typeof parsed.yaml !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBackup(backup: RecommendedBackup | null) {
  try {
    if (backup) localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backup));
    else localStorage.removeItem(BACKUP_STORAGE_KEY);
  } catch {
    // 本地存储不可用时只影响「还原」，不影响应用
  }
}

function notifyChanged() {
  useConfigStore.getState().clearCache();
  window.dispatchEvent(new Event(RECOMMENDED_CONFIG_CHANGED_EVENT));
}

function fieldUrl(path: readonly string[]) {
  return `/config/${path.map((key) => encodeURIComponent(key)).join('/')}`;
}

/** 应用：先备份（整份 config.yaml + 字段原值），再只 PATCH 勾选项（overrides = 编辑时自己填的值） */
export async function applyRecommended(
  apiBase: string,
  config: unknown,
  ruleIds: string[],
  overrides: Readonly<Record<string, ConfigScalar>> = {}
): Promise<RecommendedBackup> {
  const revision = apiClient.getConnectionRevision();
  const yaml = await configFileApi.fetchConfigYaml();
  const backup: RecommendedBackup = {
    createdAt: new Date().toISOString(),
    apiBase,
    yaml,
    undo: buildUndoEntries(config, ruleIds),
  };
  writeBackup(backup);
  if (apiClient.getConnectionRevision() !== revision) {
    throw new Error('Connection changed while applying configuration');
  }
  await apiClient.patch('/config', buildRecommendedPatch(ruleIds, overrides));
  notifyChanged();
  return backup;
}

/** 还原：只把上次应用改过的字段恢复成原值（原本没写的字段删除），不覆盖整份文件 */
export async function restoreRecommended(backup: RecommendedBackup): Promise<void> {
  const { patch, deletions } = splitUndo(backup.undo);
  if (Object.keys(patch).length) await apiClient.patch('/config', patch);
  for (const path of deletions) {
    try {
      await apiClient.delete(fieldUrl(path));
    } catch (error: unknown) {
      const status = (error as { status?: number } | null)?.status;
      if (status !== 404) throw error;
    }
  }
  writeBackup(null);
  notifyChanged();
}

export function downloadBackup(backup: RecommendedBackup) {
  const stamp = backup.createdAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  const blob = new Blob([backup.yaml], { type: 'application/yaml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `config.yaml.bak.${stamp}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 页面用：读取原始配置 */
export function useRawConfig() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [config, setConfig] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setConfig(await fetchRawConfig());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connectionStatus === 'connected') void reload();
  }, [connectionStatus, reload]);

  return { config, loading, error, reload };
}

/** 侧边栏角标用：待优化项数量（读取失败时返回 undefined，不显示角标） */
export function useRecommendedPendingCount(): number | undefined {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      setCount(undefined);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchRawConfig()
        .then((config) => {
          if (!cancelled) setCount(countPending(config));
        })
        .catch(() => {
          if (!cancelled) setCount(undefined);
        });
    };
    load();
    window.addEventListener(RECOMMENDED_CONFIG_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(RECOMMENDED_CONFIG_CHANGED_EVENT, load);
    };
  }, [connectionStatus]);

  return count;
}
