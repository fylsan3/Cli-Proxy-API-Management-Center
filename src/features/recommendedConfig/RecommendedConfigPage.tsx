/**
 * 二开：推荐参数页面（新增页面，不修改任何原有功能）。
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  IconAlertTriangle,
  IconCheck,
  IconCheckCircle2,
  IconDownload,
  IconEye,
  IconInfo,
  IconRefreshCw,
} from '@/components/ui/icons';
import { useAuthStore, useNotificationStore } from '@/stores';
import {
  checkRules,
  checkSafety,
  formatValue,
  type RuleCheckResult,
  type RuleGroup,
} from './rules';
import {
  applyRecommended,
  downloadBackup,
  readBackup,
  restoreRecommended,
  useRawConfig,
  type RecommendedBackup,
} from './useRecommendedConfig';
import styles from './RecommendedConfigPage.module.scss';

type Filter = 'all' | 'pending';

export function RecommendedConfigPage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const apiBase = useAuthStore((state) => state.apiBase);
  const { config, loading, error, reload } = useRawConfig();

  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backup, setBackup] = useState<RecommendedBackup | null>(() => readBackup(apiBase));

  const results = useMemo(() => (config ? checkRules(config) : []), [config]);
  const safety = useMemo(() => (config ? checkSafety(config) : []), [config]);
  const pending = results.filter((item) => !item.ok);

  // 加载/刷新后：默认勾选 A 组待优化项；B 组默认不勾
  useEffect(() => {
    setSelected(
      new Set(
        results.filter((item) => !item.ok && item.rule.group === 'A').map((item) => item.rule.id)
      )
    );
  }, [results]);

  useEffect(() => {
    setBackup(readBackup(apiBase));
  }, [apiBase]);

  const toggle = (id: string, value: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedIds = pending
    .filter((item) => selected.has(item.rule.id))
    .map((item) => item.rule.id);

  const handleApply = async () => {
    if (!confirmIds?.length) return;
    setApplying(true);
    try {
      const saved = await applyRecommended(apiBase, config, confirmIds);
      setBackup(saved);
      setConfirmIds(null);
      showNotification(
        t('recommended_config.apply_success', { count: confirmIds.length }),
        'success'
      );
      await reload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showNotification(
        `${t('recommended_config.apply_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setApplying(false);
    }
  };

  const handleRestore = async () => {
    if (!backup) return;
    setRestoring(true);
    try {
      await restoreRecommended(backup);
      setBackup(null);
      showNotification(t('recommended_config.restore_success'), 'success');
      await reload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showNotification(
        `${t('recommended_config.restore_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRestoring(false);
    }
  };

  const pathText = (item: RuleCheckResult) => item.rule.path.join('.');
  const currentText = (item: RuleCheckResult) =>
    item.present
      ? formatValue(item.raw)
      : t('recommended_config.not_set', { value: formatValue(item.rule.fallback) });

  const renderRule = (item: RuleCheckResult) => {
    const id = item.rule.id;
    return (
      <div key={id} className={`${styles.row} ${item.ok ? '' : styles.rowPending}`}>
        <div className={styles.rowCheck}>
          {item.ok ? (
            <span className={styles.okIcon} aria-label={t('recommended_config.status_ok')}>
              <IconCheckCircle2 size={18} />
            </span>
          ) : (
            <SelectionCheckbox
              checked={selected.has(id)}
              onChange={(value) => toggle(id, value)}
              ariaLabel={t(`recommended_config.rules.${id}.title`)}
            />
          )}
        </div>
        <div className={styles.rowMain}>
          <div className={styles.rowTitle}>
            {t(`recommended_config.rules.${id}.title`)}
            <span className={item.ok ? styles.badgeOk : styles.badgePending}>
              {item.ok ? t('recommended_config.status_ok') : t('recommended_config.status_pending')}
            </span>
          </div>
          <code className={styles.path}>{pathText(item)}</code>
          <div className={styles.desc}>{t(`recommended_config.rules.${id}.desc`)}</div>
        </div>
        <div className={styles.rowValues}>
          <div className={styles.valueLine}>
            <span className={styles.valueLabel}>{t('recommended_config.current')}</span>
            <span className={item.ok ? styles.valueOk : styles.valueOld}>{currentText(item)}</span>
          </div>
          <div className={styles.valueLine}>
            <span className={styles.valueLabel}>{t('recommended_config.recommended')}</span>
            <span className={styles.valueNew}>{formatValue(item.rule.recommended)}</span>
          </div>
          {!item.ok && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmIds([id])}>
              {t('recommended_config.apply_one')}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderGroup = (group: RuleGroup) => {
    const items = results.filter(
      (item) => item.rule.group === group && (filter === 'all' || !item.ok)
    );
    return (
      <Card
        title={t(`recommended_config.group_${group.toLowerCase()}`)}
        extra={
          <span className={styles.groupHint}>
            {t(`recommended_config.group_${group.toLowerCase()}_hint`)}
          </span>
        }
      >
        {items.length ? (
          <div className={styles.list}>{items.map(renderRule)}</div>
        ) : (
          <div className={styles.empty}>{t('recommended_config.group_all_ok')}</div>
        )}
      </Card>
    );
  };

  const confirmItems = results.filter((item) => confirmIds?.includes(item.rule.id));
  const backupTime = backup
    ? new Date(backup.createdAt).toLocaleString(i18n.language || undefined)
    : '';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('recommended_config.title')}</h1>
          <p className={styles.subtitle}>{t('recommended_config.subtitle')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void reload()} loading={loading}>
          <span className={styles.btnInner}>
            <IconRefreshCw size={14} />
            {t('recommended_config.recheck')}
          </span>
        </Button>
      </div>

      {error ? (
        <div className={styles.alertError}>
          <IconAlertTriangle size={16} />
          <span>
            {t('recommended_config.load_failed')}: {error}
          </span>
        </div>
      ) : null}

      {config ? (
        <>
          <div className={pending.length ? styles.summaryPending : styles.summaryOk}>
            {pending.length ? <IconAlertTriangle size={16} /> : <IconCheckCircle2 size={16} />}
            <span>
              {pending.length
                ? t('recommended_config.summary_pending', { count: pending.length })
                : t('recommended_config.summary_ok')}
            </span>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.segment} role="tablist">
              {(['all', 'pending'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  className={filter === value ? styles.segmentActive : styles.segmentItem}
                  onClick={() => setFilter(value)}
                >
                  {t(`recommended_config.filter_${value}`)}
                </button>
              ))}
            </div>
            <div className={styles.toolbarActions}>
              <Button
                variant="ghost"
                size="sm"
                disabled={!pending.length}
                onClick={() => setSelected(new Set(pending.map((item) => item.rule.id)))}
              >
                {t('recommended_config.select_all_pending')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!selected.size}
                onClick={() => setSelected(new Set())}
              >
                {t('recommended_config.clear_selection')}
              </Button>
            </div>
          </div>

          {renderGroup('A')}
          {renderGroup('B')}

          <Card
            title={t('recommended_config.group_c')}
            extra={<span className={styles.groupHint}>{t('recommended_config.group_c_hint')}</span>}
          >
            <div className={styles.list}>
              {safety.map((item) => (
                <div key={item.id} className={styles.safetyRow}>
                  <span
                    className={
                      item.level === 'ok'
                        ? styles.okIcon
                        : item.level === 'warn'
                          ? styles.warnIcon
                          : styles.infoIcon
                    }
                  >
                    {item.level === 'ok' ? (
                      <IconCheckCircle2 size={18} />
                    ) : item.level === 'warn' ? (
                      <IconAlertTriangle size={18} />
                    ) : (
                      <IconInfo size={18} />
                    )}
                  </span>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>
                      {t(`recommended_config.safety.${item.id}.title`)}
                    </div>
                    <div className={styles.desc}>
                      {t(
                        `recommended_config.safety.${item.id}.${item.level === 'ok' ? 'ok' : 'tip'}`,
                        {
                          value: item.current,
                        }
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className={styles.actionBar}>
            <div className={styles.backupInfo}>
              <IconDownload size={16} />
              {backup ? (
                <>
                  <span>{t('recommended_config.backup_at', { time: backupTime })}</span>
                  <Button variant="ghost" size="sm" onClick={() => downloadBackup(backup)}>
                    {t('recommended_config.download')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={restoring}
                    onClick={() => void handleRestore()}
                  >
                    {t('recommended_config.restore')}
                  </Button>
                </>
              ) : (
                <span>{t('recommended_config.backup_none')}</span>
              )}
            </div>
            <div className={styles.applyActions}>
              <Button
                variant="secondary"
                disabled={!selectedIds.length}
                onClick={() => setConfirmIds(selectedIds)}
              >
                <span className={styles.btnInner}>
                  <IconEye size={16} />
                  {t('recommended_config.preview')}
                </span>
              </Button>
              <Button
                variant="primary"
                disabled={!selectedIds.length}
                onClick={() => setConfirmIds(selectedIds)}
              >
                <span className={styles.btnInner}>
                  <IconCheck size={16} />
                  {t('recommended_config.apply_n', { count: selectedIds.length })}
                </span>
              </Button>
            </div>
          </div>
        </>
      ) : null}

      <Modal
        open={confirmIds !== null}
        title={t('recommended_config.confirm_title', { count: confirmItems.length })}
        onClose={() => !applying && setConfirmIds(null)}
        closeDisabled={applying}
        footer={
          <>
            <Button variant="ghost" disabled={applying} onClick={() => setConfirmIds(null)}>
              {t('recommended_config.cancel')}
            </Button>
            <Button variant="primary" loading={applying} onClick={() => void handleApply()}>
              {t('recommended_config.confirm')}
            </Button>
          </>
        }
      >
        <div className={styles.confirmList}>
          {confirmItems.map((item) => (
            <div key={item.rule.id} className={styles.confirmRow}>
              <div className={styles.confirmName}>
                {t(`recommended_config.rules.${item.rule.id}.title`)}
                <code className={styles.path}>{pathText(item)}</code>
              </div>
              <div className={styles.confirmDiff}>
                <span className={styles.diffOld}>{currentText(item)}</span>
                <span aria-hidden="true">→</span>
                <span className={styles.diffNew}>{formatValue(item.rule.recommended)}</span>
              </div>
            </div>
          ))}
        </div>
        <p className={styles.confirmNote}>{t('recommended_config.confirm_note')}</p>
      </Modal>
    </div>
  );
}
