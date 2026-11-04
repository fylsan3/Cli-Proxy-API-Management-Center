import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useThemeStore } from '@/stores';
import iconVertex from '@/assets/icons/vertex.svg';
import iconCodex from '@/assets/icons/codex.svg';
import { KIMI_DISPLAY_NAME } from '@/features/providers/kimi';
import { OAuthHeader } from './components/OAuthHeader';
import { ProviderTile } from './components/ProviderTile';
import { SponsorCard, type SponsorCardSite } from './components/SponsorCard';
import { OAuthFlowDialog, type DialogHeading } from './components/OAuthFlowDialog';
import { VertexImportDialog } from './components/VertexImportDialog';
import { SiwcBindDialog } from './components/SiwcBindDialog';
import {
  useOAuthFlows,
  usePluginOAuthProviders,
  type ProviderFlowState,
} from './hooks/useOAuthFlows';
import { useVertexImport } from './hooks/useVertexImport';
import { checkProxyEgress, proxyCheckFailureKey } from './proxyEgressCheck';
import type { ProxyCheckView } from './components/OAuthFlowDialog';
import {
  isSponsor,
  OAUTH_PROVIDERS,
  resolveThemedIcon,
  supportsManualCallback,
  type OAuthProviderCard,
} from './providers';
import styles from './OAuthPage.module.scss';

/** 对话框焦点标识：Vertex 不是 OAuth 提供商，用保留 id 避免与提供商冲突。 */
const VERTEX_DIALOG_ID = '__vertex__';
const VERTEX_LABEL = 'Vertex AI';

type DialogTarget = { kind: 'oauth'; id: string } | { kind: 'vertex' };

/**
 * OAuth 登录：提供商画廊（一屏看全）+ 聚焦的授权对话框。
 *
 * 二开：点磁贴只打开对话框，先（可选）填会话代理，再点「开始登录」才创建会话；
 * 对话框可随时关闭，授权在后台继续，磁贴副行实时反映进度。
 * 对话框关闭后保留最后一个目标，让退出动画期间内容不消失。
 */
export function OAuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const apiBase = useAuthStore((state) => state.apiBase);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const revealRef = useRevealGroup<HTMLDivElement>();
  const otherMethodsId = useId();

  const pluginProviders = usePluginOAuthProviders(apiBase);
  const providerCards = useMemo<OAuthProviderCard[]>(
    () => [...OAUTH_PROVIDERS, ...pluginProviders],
    [pluginProviders]
  );

  const focusedRef = useRef<string | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // 二开：每个提供商一份代理草稿（非必填）。仅存在内存，不落 localStorage。
  const [proxyDrafts, setProxyDrafts] = useState<Record<string, string>>({});
  // 二开 #27：每个提供商一份代理检测结果；改了代理就清掉，避免拿旧结果放行。
  const [proxyChecks, setProxyChecks] = useState<Record<string, ProxyCheckView>>({});
  const checkSeq = useRef<Record<string, number>>({});
  const setProxyCheck = (provider: string, view: ProxyCheckView | undefined) =>
    setProxyChecks((prev) => {
      const next = { ...prev };
      if (view) next[provider] = view;
      else delete next[provider];
      return next;
    });
  const setProxyDraft = (provider: string, value: string) => {
    setProxyDrafts((prev) => ({ ...prev, [provider]: value }));
    checkSeq.current[provider] = (checkSeq.current[provider] ?? 0) + 1;
    setProxyCheck(provider, undefined);
  };

  /**
   * 二开 #27：填了代理就先测出口 IP，通过才创建登录会话；留空维持原行为（全程直连）。
   */
  const startWithProxyCheck = async (provider: string) => {
    const proxy = (proxyDrafts[provider] ?? '').trim();
    if (!proxy) {
      setProxyCheck(provider, undefined);
      void flows.startAuth(provider, undefined);
      return;
    }
    const seq = (checkSeq.current[provider] ?? 0) + 1;
    checkSeq.current[provider] = seq;
    setProxyCheck(provider, { status: 'checking' });
    const result = await checkProxyEgress(proxy);
    if (checkSeq.current[provider] !== seq) return; // 期间改了代理或重新检测
    if (!result.ok) {
      setProxyCheck(provider, {
        status: 'failed',
        message: t(proxyCheckFailureKey(result.reason), { detail: result.detail ?? '' }),
      });
      return;
    }
    setProxyCheck(provider, { status: 'passed', ip: result.ip, location: result.location });
    void flows.startAuth(provider, proxy);
  };
  const [siwcOpen, setSiwcOpen] = useState(false);
  // 每次打开换新 key 重新挂载（全新选择与会话）；关闭后保持挂载，让退出动画走完
  const [siwcKey, setSiwcKey] = useState(0);
  const openSiwc = () => {
    setSiwcKey((key) => key + 1);
    setSiwcOpen(true);
  };

  const flows = useOAuthFlows({
    providerCards,
    isFocused: (provider) => focusedRef.current === provider,
  });
  const vertexImport = useVertexImport({
    isFocused: () => focusedRef.current === VERTEX_DIALOG_ID,
    onCredentialAdded: flows.recordCredentialAdded,
  });

  const labelOf = (card: OAuthProviderCard) =>
    card.kind === 'plugin'
      ? card.title
      : typeof card.label === 'string'
        ? card.label
        : t(card.label.key);

  const captionOf = (card: OAuthProviderCard) => {
    if (card.kind === 'plugin') return t('auth_login.method_plugin');
    const method = t(
      card.flow === 'device' ? 'auth_login.method_device' : 'auth_login.method_browser'
    );
    return card.domain ? `${card.domain} · ${method}` : method;
  };

  const iconOf = (card: OAuthProviderCard) =>
    card.kind === 'plugin' ? card.icon : resolveThemedIcon(card.icon, resolvedTheme);

  const headingOf = (card: OAuthProviderCard): DialogHeading => ({
    title:
      card.kind === 'plugin'
        ? t('auth_login.plugin_oauth_title', { name: card.title })
        : t(card.titleKey),
    caption: captionOf(card),
    icon: iconOf(card),
  });

  const sponsorOf = (card: OAuthProviderCard) =>
    isSponsor(card)
      ? { url: card.sponsor.signUpUrl, label: t('auth_login.kimi_sign_up_button') }
      : undefined;

  const tileStatusLabel = (status: ProviderFlowState['status']) =>
    status === 'waiting'
      ? t('auth_login.tile_waiting')
      : status === 'success'
        ? t('auth_login.tile_success')
        : status === 'error'
          ? t('auth_login.tile_error')
          : undefined;

  const openProvider = (card: OAuthProviderCard) => {
    focusedRef.current = card.id;
    setDialog({ kind: 'oauth', id: card.id });
    setDialogOpen(true);
    // 二开：不再自动开始登录。否则会话在用户填代理前就已创建（且是直连），
    // 造成「浏览器走代理、兑换直连」的配一半。改为在对话框里点「开始登录」。
  };

  const openVertex = () => {
    focusedRef.current = VERTEX_DIALOG_ID;
    setDialog({ kind: 'vertex' });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (dialog?.kind === 'oauth') flows.dismissSuccess(dialog.id);
    if (dialog?.kind === 'vertex' && vertexImport.vertex.result) vertexImport.resetForAnother();
    focusedRef.current = null;
    setDialogOpen(false);
  };

  const viewAuthFiles = () => navigate('/auth-files');

  const dialogCard =
    dialog?.kind === 'oauth' ? providerCards.find((card) => card.id === dialog.id) : undefined;
  const providerCount = providerCards.length;
  const sponsorCards = providerCards.filter(isSponsor);
  const regularCards = providerCards.filter((card) => !isSponsor(card));
  // 赞助商卡占级联的第 0 位，其余磁贴顺延
  const tileIndexOffset = sponsorCards.length > 0 ? 1 : 0;

  const sponsorSites: SponsorCardSite[] = sponsorCards.map((card) => {
    const status = flows.states[card.id]?.status;
    return {
      id: card.id,
      name: labelOf(card),
      region: t(card.sponsor.siteKey),
      domain: card.domain ?? '',
      status,
      statusLabel: tileStatusLabel(status),
      signUpUrl: card.sponsor.signUpUrl,
    };
  });

  const renderTile = (card: OAuthProviderCard, index: number) => {
    const status = flows.states[card.id]?.status;
    return (
      <ProviderTile
        key={card.id}
        label={labelOf(card)}
        caption={captionOf(card)}
        icon={iconOf(card)}
        index={index + tileIndexOffset}
        status={status}
        statusLabel={tileStatusLabel(status)}
        onOpen={() => openProvider(card)}
      />
    );
  };
  const waitingCount = Object.values(flows.states).filter(
    (state) => state.status === 'waiting'
  ).length;

  return (
    <div className={styles.page} ref={revealRef}>
      <OAuthHeader
        providerCount={providerCount}
        waitingCount={waitingCount}
        addedCount={flows.addedCount}
      />

      {/* 赞助商独占首行：一张品牌卡收拢两站入口，其余提供商在下方紧凑网格 */}
      {sponsorCards.length > 0 && (
        <SponsorCard
          title={KIMI_DISPLAY_NAME}
          caption={t('auth_login.sponsor_kimi_caption')}
          icon={iconOf(sponsorCards[0])}
          signUpLabel={t('auth_login.sponsor_sign_up')}
          sites={sponsorSites}
          onOpen={(siteId) => {
            const card = sponsorCards.find((sponsor) => sponsor.id === siteId);
            if (card) openProvider(card);
          }}
        />
      )}
      <div className={styles.grid}>{regularCards.map(renderTile)}</div>

      <section className={styles.section} aria-labelledby={otherMethodsId}>
        <h2 className={styles.sectionLabel} id={otherMethodsId} data-reveal>
          {t('auth_login.other_login_methods')}
        </h2>
        <div className={styles.grid}>
          <ProviderTile
            label={VERTEX_LABEL}
            caption={t('vertex_import.file_label')}
            icon={iconVertex}
            index={regularCards.length + tileIndexOffset}
            onOpen={openVertex}
          />
          <ProviderTile
            label={t('siwc.bind')}
            caption={t('siwc.tile_caption')}
            icon={iconCodex}
            index={regularCards.length + tileIndexOffset + 1}
            onOpen={openSiwc}
          />
        </div>
      </section>

      {dialogCard && (
        <OAuthFlowDialog
          open={dialogOpen && dialog?.kind === 'oauth'}
          providerId={dialogCard.id}
          heading={headingOf(dialogCard)}
          state={flows.states[dialogCard.id] ?? {}}
          text={(suffix) => flows.providerText(dialogCard.id, suffix)}
          supportsCallback={supportsManualCallback(dialogCard)}
          sponsor={sponsorOf(dialogCard)}
          onStart={() => void startWithProxyCheck(dialogCard.id)}
          proxy={proxyDrafts[dialogCard.id] ?? ''}
          proxyCheck={proxyChecks[dialogCard.id]}
          onProxyChange={(value) => setProxyDraft(dialogCard.id, value)}
          onLoginAnother={() => {
            // 换账号 = 换出口：回到填代理的初始页，并清空上一个账号的代理
            flows.dismissSuccess(dialogCard.id);
            setProxyDraft(dialogCard.id, '');
          }}
          onCancel={() => void flows.cancelAuth(dialogCard.id)}
          onCallbackChange={(value) => flows.setCallbackInput(dialogCard.id, value)}
          onCallbackSubmit={() => void flows.submitCallback(dialogCard.id)}
          onViewAuthFiles={viewAuthFiles}
          onClose={closeDialog}
        />
      )}

      <VertexImportDialog
        open={dialogOpen && dialog?.kind === 'vertex'}
        heading={{
          title: t('vertex_import.title'),
          caption: t('vertex_import.file_label'),
          icon: iconVertex,
        }}
        vertex={vertexImport.vertex}
        onPickFile={vertexImport.pickFile}
        onLocationChange={vertexImport.setLocation}
        onImport={() => void vertexImport.importCredential()}
        onImportAnother={vertexImport.resetForAnother}
        onViewAuthFiles={viewAuthFiles}
        onClose={closeDialog}
      />

      {siwcKey > 0 && (
        <SiwcBindDialog
          key={siwcKey}
          open={siwcOpen}
          onClose={() => setSiwcOpen(false)}
          onViewAuthFiles={viewAuthFiles}
        />
      )}
    </div>
  );
}
