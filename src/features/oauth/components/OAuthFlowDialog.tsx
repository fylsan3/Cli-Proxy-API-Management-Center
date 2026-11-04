import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { IconExternalLink, IconLoader2 } from '@/components/ui/icons';
import type { ProviderFlowState } from '../hooks/useOAuthFlows';
import { resolveFlowView, splitAuthUrl, type FlowView } from '../flowView';
import { BrandGlyph } from './BrandGlyph';
import { CopyButton } from './CopyButton';
import styles from './OAuthFlowDialog.module.scss';

export interface DialogHeading {
  title: string;
  caption: string;
  icon: string;
}

export function DialogTitle({ title, caption, icon }: DialogHeading) {
  return (
    <span className={styles.heading}>
      <span className={styles.headingGlyph}>
        <BrandGlyph src={icon} size={22} className={styles.headingImage} />
      </span>
      <span className={styles.headingText}>
        <span className={styles.headingTitle}>{title}</span>
        <span className={styles.headingCaption}>{caption}</span>
      </span>
    </span>
  );
}

/** 二开 #27：代理出口检测状态。 */
export type ProxyCheckView =
  | { status: 'checking' }
  | { status: 'passed'; ip: string; location: string }
  | { status: 'failed'; message: string };

export interface OAuthFlowDialogProps {
  open: boolean;
  providerId: string;
  heading: DialogHeading;
  state: ProviderFlowState;
  /** 提供商专属文案：`auth_login.<id>_<suffix>` 或插件模板。 */
  text: (suffix: string) => string;
  supportsCallback: boolean;
  /** 赞助商：品牌蓝主按钮 + 提示行里的注册链接。 */
  sponsor?: { url: string; label: string };
  onStart: () => void;
  /** 二开：会话代理草稿（非必填，留空 = 全程直连）。 */
  proxy: string;
  onProxyChange: (value: string) => void;
  /** 二开 #27：填了代理时，开始前的出口检测结果。 */
  proxyCheck?: ProxyCheckView;
  /** 二开：成功页「再登录一个账号」→ 回到填代理的初始页，而不是直接开始。 */
  onLoginAnother: () => void;
  onCancel: () => void;
  onCallbackChange: (value: string) => void;
  onCallbackSubmit: () => void;
  onViewAuthFiles: () => void;
  onClose: () => void;
}

export function OAuthFlowDialog(props: OAuthFlowDialogProps) {
  const { open, heading, state, onClose } = props;
  const view = resolveFlowView(state);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={500}
      className={props.sponsor ? `${styles.dialog} ${styles.sponsorDialog}` : styles.dialog}
      title={<DialogTitle {...heading} />}
      footer={view === 'flow' ? <FlowStatusBar {...props} /> : undefined}
    >
      <div className={styles.view} key={view}>
        {view === 'success' ? <SuccessView {...props} /> : <FlowBody {...props} view={view} />}
      </div>
    </Modal>
  );
}

function ProviderHint({ text, sponsor }: Pick<OAuthFlowDialogProps, 'text' | 'sponsor'>) {
  const { t } = useTranslation();
  return (
    <p className={styles.hint}>
      {text('oauth_hint')}
      {sponsor && (
        <>
          {' '}
          <span className={styles.signUpPrompt}>{t('auth_login.sign_up_prompt')}</span>
          <a
            className={styles.inlineLink}
            href={sponsor.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {sponsor.label}
            <IconExternalLink size={11} aria-hidden="true" />
          </a>
        </>
      )}
    </p>
  );
}

function FlowBody(props: OAuthFlowDialogProps & { view: Exclude<FlowView, 'success'> }) {
  const { t } = useTranslation();
  const { view, providerId, state, text, onStart } = props;
  const isDevin = providerId === 'devin';

  if (view !== 'flow') {
    return (
      <div className={styles.stack}>
        <ProviderHint text={text} sponsor={props.sponsor} />
        {view === 'failed' && (
          <div className={styles.alert} role="alert">
            {text('oauth_status_error')} {state.error || ''}
          </div>
        )}
        <form
          className={styles.stack}
          onSubmit={(event) => {
            event.preventDefault();
            onStart();
          }}
        >
          <ProxyField value={props.proxy} onChange={props.onProxyChange} />
          <ProxyCheckNotice check={props.proxyCheck} />
          <div>
            <button
              type="submit"
              className={styles.primary}
              disabled={props.proxyCheck?.status === 'checking'}
            >
              {props.proxyCheck?.status === 'checking' && (
                <IconLoader2 size={14} className={styles.spinning} aria-hidden="true" />
              )}
              {view === 'failed' ? t('auth_login.restart_login') : text('oauth_button')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <ProviderHint text={text} sponsor={props.sponsor} />
      {isDevin && state.state && state.status === 'error' && (
        <div className={styles.alert} role="alert">
          {t('auth_login.devin_oauth_retry_hint')}
        </div>
      )}
      {state.cancelError && (
        <div className={styles.alert} role="alert">
          {t('auth_login.devin_oauth_cancel_error')} {state.cancelError}
        </div>
      )}
      <p className={styles.stepHint}>
        {state.proxyUrl
          ? t('auth_login.proxy_in_use', { proxy: state.proxyUrl })
          : t('auth_login.proxy_direct')}
      </p>
      {props.proxyCheck?.status === 'passed' && state.proxyUrl && (
        <ProxyCheckNotice check={props.proxyCheck} />
      )}
      <ol className={styles.steps}>
        <OpenStep {...props} />
        {state.userCode && (
          <Step title={t('auth_login.step_enter_device_code')}>
            <div className={styles.codeRow}>
              <output className={styles.code} aria-label={t('auth_login.device_code_label')}>
                {state.userCode}
              </output>
              <CopyButton
                value={state.userCode}
                label={t('auth_login.device_code_copy')}
                showLabel
              />
            </div>
          </Step>
        )}
        {props.supportsCallback && <CallbackStep {...props} />}
      </ol>
    </div>
  );
}

/**
 * 二开：会话代理输入框。非必填、不做校验；留空时请求体不带 proxy_url（全程直连）。
 * 填了则 授权链接生成 → 兑换 → 后续调用 → 刷新 全程走这条代理（后端写进凭证的 proxy-url）。
 */
function ProxyField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const inputId = useId();
  const hintId = useId();
  return (
    <div className={styles.proxyField}>
      <div className={styles.stepHead}>
        <label className={styles.stepTitle} htmlFor={inputId}>
          {t('auth_login.proxy_label')}
        </label>
        <span className={styles.optional}>{t('auth_login.optional_step')}</span>
      </div>
      <input
        id={inputId}
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('auth_login.proxy_placeholder')}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hintId}
      />
      <p className={styles.stepHint} id={hintId}>
        {t('auth_login.proxy_hint')}
      </p>
    </div>
  );
}

/** 二开 #27：检测中 / 通过（出口 IP）/ 失败（原因）。未检测时不渲染。 */
function ProxyCheckNotice({ check }: { check?: ProxyCheckView }) {
  const { t } = useTranslation();
  if (!check) return null;
  if (check.status === 'checking') {
    return (
      <p className={styles.stepHint} role="status">
        {t('auth_login.proxy_check_checking')}
      </p>
    );
  }
  if (check.status === 'passed') {
    return (
      <p className={styles.feedbackSuccess} role="status">
        {t('auth_login.proxy_check_passed', {
          ip: check.ip,
          location: check.location || '-',
        })}
      </p>
    );
  }
  return (
    <div className={styles.alert} role="alert">
      {check.message}
    </div>
  );
}

function Step({
  title,
  titleFor,
  aside,
  children,
}: {
  title: string;
  titleFor?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className={styles.step}>
      <span className={styles.stepIndex} aria-hidden="true" />
      <div className={styles.stepBody}>
        <div className={styles.stepHead}>
          {titleFor ? (
            <label className={styles.stepTitle} htmlFor={titleFor}>
              {title}
            </label>
          ) : (
            <span className={styles.stepTitle}>{title}</span>
          )}
          {aside}
        </div>
        {children}
      </div>
    </li>
  );
}

function OpenStep({ state, text }: OAuthFlowDialogProps) {
  const { t } = useTranslation();
  const url = state.url;
  const parts = url ? splitAuthUrl(url) : null;

  return (
    <Step title={t('auth_login.step_open_auth_page')}>
      <div className={styles.urlField} aria-busy={!url}>
        {parts ? (
          <span className={styles.urlText} title={url}>
            <span className={styles.urlHost}>{parts.host}</span>
            <span className={styles.urlRest}>{parts.rest}</span>
          </span>
        ) : (
          <span className={styles.urlSkeleton} aria-label={t('auth_login.generating_link')} />
        )}
        {url && <CopyButton value={url} label={text('copy_link')} />}
      </div>
      <div>
        <button
          type="button"
          className={styles.primary}
          disabled={!url}
          onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
        >
          {text('open_link')}
          <IconExternalLink size={14} aria-hidden="true" />
        </button>
      </div>
    </Step>
  );
}

function CallbackStep({
  providerId,
  state,
  onCallbackChange,
  onCallbackSubmit,
}: OAuthFlowDialogProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const hintId = useId();
  const feedbackId = useId();
  const isXai = providerId === 'xai';
  const isDevin = providerId === 'devin';
  const disabled = !state.url || (isDevin && (state.cancelling || state.status !== 'waiting'));
  const hintKey = isXai
    ? 'auth_login.xai_callback_hint'
    : isDevin
      ? 'auth_login.devin_callback_hint'
      : 'auth_login.oauth_callback_hint';
  const placeholderKey = isXai
    ? 'auth_login.xai_callback_placeholder'
    : isDevin
      ? 'auth_login.devin_callback_placeholder'
      : 'auth_login.oauth_callback_placeholder';

  const feedback = state.callbackValidation
    ? { tone: 'error' as const, message: state.callbackValidation }
    : state.callbackStatus === 'error'
      ? {
          tone: 'error' as const,
          message: `${t('auth_login.oauth_callback_status_error')} ${state.callbackError || ''}`,
        }
      : state.callbackStatus === 'success' && state.status === 'waiting'
        ? { tone: 'success' as const, message: t('auth_login.oauth_callback_status_success') }
        : null;

  return (
    <Step
      title={t(isXai ? 'auth_login.xai_callback_label' : 'auth_login.oauth_callback_label')}
      titleFor={inputId}
      aside={<span className={styles.optional}>{t('auth_login.optional_step')}</span>}
    >
      <p className={styles.stepHint} id={hintId}>
        {t(hintKey)}
      </p>
      <form
        className={styles.callbackRow}
        onSubmit={(event) => {
          event.preventDefault();
          onCallbackSubmit();
        }}
      >
        <input
          id={inputId}
          className={`input ${styles.callbackInput}`}
          value={state.callbackUrl || ''}
          onChange={(event) => onCallbackChange(event.target.value)}
          placeholder={t(placeholderKey)}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={feedback?.tone === 'error'}
          aria-describedby={feedback ? `${feedbackId} ${hintId}` : hintId}
        />
        <button
          type="submit"
          className={styles.secondary}
          disabled={disabled || state.callbackSubmitting}
        >
          {state.callbackSubmitting && (
            <IconLoader2 size={14} className={styles.spinning} aria-hidden="true" />
          )}
          {t('auth_login.oauth_callback_button')}
        </button>
      </form>
      {feedback && (
        <p
          id={feedbackId}
          className={feedback.tone === 'error' ? styles.feedbackError : styles.feedbackSuccess}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      )}
    </Step>
  );
}

function FlowStatusBar({ providerId, state, text, onStart, onCancel }: OAuthFlowDialogProps) {
  const { t } = useTranslation();
  const isDevin = providerId === 'devin';
  const failed = state.status === 'error';
  const generating = !failed && !state.url;
  // Devin 会话在服务端可能仍挂着：必须先取消才能重开
  const canCancel = isDevin && Boolean(state.state);

  return (
    <div className={styles.statusBar} data-tone={failed ? 'error' : 'waiting'}>
      <p className={styles.statusText} role="status" aria-live="polite">
        {generating ? (
          <IconLoader2 size={13} className={styles.spinning} aria-hidden="true" />
        ) : (
          <span className={styles.statusDot} aria-hidden="true" />
        )}
        <span className={styles.statusLabel}>
          {generating
            ? t('auth_login.generating_link')
            : failed
              ? `${text('oauth_status_error')} ${state.error || ''}`
              : text('oauth_status_waiting')}
        </span>
      </p>
      {canCancel ? (
        <button
          type="button"
          className={styles.ghost}
          onClick={onCancel}
          disabled={state.cancelling}
        >
          {state.cancelling && (
            <IconLoader2 size={13} className={styles.spinning} aria-hidden="true" />
          )}
          {t('auth_login.devin_oauth_cancel')}
        </button>
      ) : failed ? (
        <button type="button" className={styles.ghost} onClick={onStart}>
          {t('auth_login.restart_login')}
        </button>
      ) : (
        <span className={styles.statusAside}>{t('auth_login.waiting_background_hint')}</span>
      )}
    </div>
  );
}

function SuccessView({ text, onLoginAnother, onViewAuthFiles }: OAuthFlowDialogProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.result} role="status">
      <svg className={styles.successMark} viewBox="0 0 52 52" aria-hidden="true">
        <circle className={styles.successRing} cx="26" cy="26" r="24" />
        <path className={styles.successCheck} d="M16 27l7 7 14-15" />
      </svg>
      <div className={styles.resultTitle}>{text('oauth_status_success')}</div>
      <p className={styles.resultHint}>{t('auth_login.success_saved_hint')}</p>
      <div className={styles.resultActions}>
        <button type="button" className={styles.secondary} onClick={onViewAuthFiles}>
          {t('auth_login.view_auth_files')}
        </button>
        <button type="button" className={styles.primary} onClick={onLoginAnother}>
          {t('auth_login.login_another_account')}
        </button>
      </div>
    </div>
  );
}
