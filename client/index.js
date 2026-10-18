/* Hand-written rc.1 client module: no build step and no credential state/store. */
window.__ModuleLoader__.load({
  id: 'dsh-admin-bridge',
  factory: require => {
    const React = require('react');
    // 0.2.0 renamed the 14px chevron atom: Regular is the default (14px) artwork.
    const { Menu, RiskConfirmation, Modal, Button, SegmentedControl, Input, IconChevronDownOutlineRegular: IconChevronDownOutline14 } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;
    const endpoint = '/admin-bridge/v1/';
    const FULL_ACCESS = 'danger-full-access';
    const SUDO = 'sudo-access';
    const emptyStatus = () => ({ state: 'unavailable', modeActive: false, operations: [] });
    const statusCheckError = '无法检查 Sudo 权限状态。宿主仍会强制执行截止时间。';
    // 0.2.0 no longer ships the 0.1.x Sh0Q9G_ CSS-module hashes, so the trigger
    // fell back to the browser's black default button box. Re-create the native
    // permission-selector look with stable class names instead of a stale hash.
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="dsh-admin-bridge"]')) {
      const tag = document.createElement('style');
      tag.dataset.pluginCss = 'dsh-admin-bridge';
      tag.textContent = `.adb-trigger{border-radius:8px;min-width:0;max-width:220px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-family:inherit;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}.adb-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.adb-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}.adb-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.adb-triggerIcon{flex:none;display:inline-flex}.adb-triggerIcon svg{width:14px;height:14px}.adb-triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.adb-chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s;display:inline-flex}.adb-chevronOpen{transform:rotate(180deg)}@container (width<=460px){.adb-trigger:has(.adb-triggerIcon) .adb-triggerLabel{display:none}}.adb-sudoDialog{width:min(560px,100%);max-height:100%}.adb-sudoContent{min-height:0;overflow-y:auto;overscroll-behavior:contain}.adb-sudoBody{display:flex;flex-direction:column;gap:12px}.adb-meta{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.adb-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}.adb-warning{margin:0;padding:12px 14px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}.adb-duration{display:flex;flex-direction:column;gap:8px}.adb-customTtl{display:flex;align-items:center;gap:8px}.adb-label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;font-weight:500}.adb-form{display:flex;flex-direction:column;gap:8px}.adb-password{width:100%;box-sizing:border-box}.adb-ttlInput{width:96px;box-sizing:border-box}.adb-ops{margin:0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.adb-pre{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);font-size:12px}`;
      document.head.appendChild(tag);
    }
    const ascii = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
    // The three native rc.1 glyphs are intentionally byte-for-byte identical path data.
    const shieldOutline = 'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z';
    const shield = () => h('path', { d: shieldOutline, stroke: 'currentColor', strokeWidth: '1.31831', strokeLinejoin: 'round' });
    const path = d => h('path', { d, fill: 'currentColor' });
    const svg = (...children) => h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, ...children);
    const glyphs = new Map([
      ['read-only', svg(shield(), path('M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z'))],
      ['workspace-write', svg(
        path('M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z'),
        path('M11.3525 5.64688V6.85688H5V5.64688H11.3525Z'),
        path('M9.5824 8.29376V9.50376H5V8.29376H9.5824Z'),
        path('M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z'),
        path('M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z'))],
      [FULL_ACCESS, svg(shield(), path('M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z'), path('M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z'))],
      [SUDO, svg(shield(), h('circle', { cx: '6.5', cy: '6.2', r: '1.65', stroke: 'currentColor', strokeWidth: '1.3' }),
        h('path', { d: 'M7.7 7.4L10.8 10.5M9.2 8.9L10.4 7.7M10.3 10L11.5 8.8', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round', strokeLinejoin: 'round' }))],
    ]);
    const labels = new Map([['read-only', '只读'], ['workspace-write', '工作区写入'], [FULL_ACCESS, '完全访问'], [SUDO, 'Sudo 权限'], ['custom', '自定义'], ['auto', '自动']]);
    function label(value, name = value) {
      if (labels.has(value) && (name === value || name === labels.get(value))) return labels.get(value);
      return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') : name;
    }
    function safeError(code) {
      if (code === 'password_required') return 'Sudo 权限需要基于密码的 sudo 认证，不支持免密码 sudo。';
      if (code === 'rate_limited') return '请稍候再请求认证。';
      return '认证未完成。请重新选择 Sudo 权限以发起新请求。';
    }
    async function post(method, payload, signal) {
      const task = fetch(endpoint + method, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Admin-Bridge': '1' },
        body: JSON.stringify(payload), signal,
      });
      payload = undefined;
      const response = await task;
      const result = await response.json();
      // Never render backend exception messages, which could contain sensitive data.
      if (!response.ok || result.error) throw new Error(safeError(result.error?.code));
      return result.value;
    }
    async function request(life, method, payload, milliseconds = 5000) {
      const controller = new AbortController();
      life.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), milliseconds);
      life.timers.add(timer);
      try {
        const task = post(method, payload, controller.signal);
        payload = undefined;
        return await task;
      } finally {
        clearTimeout(timer); life.timers.delete(timer); life.controllers.delete(controller);
      }
    }
    function revokeOnDeparture(sessionId, requestId) {
      // Never revoke an unknown intent or another tab's newer request/lease.
      // An intent whose nonce was never learned expires without starting authentication.
      if (!requestId) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      void post('lock', { sessionId, requestId }, controller.signal).catch(() => {}).finally(() => clearTimeout(timer));
    }

    // 0.2 projections expose only `currentValue`; the selector's own menu keeps
    // the three native modes this plugin's labels and glyphs already describe.
    const NATIVE_MODE_OPTIONS = [
      { value: 'read-only', name: '只读' },
      { value: 'workspace-write', name: '工作区写入' },
      { value: 'danger-full-access', name: '完全访问' },
    ];

    function PermissionControl({ sessionId, value: ownerValue, locked, command, useProjection }) {
      // DSH 0.2 session slots deliver the permissions projection through the slot
      // context rather than an owner `value` prop; accept either form.
      const projected = typeof useProjection === 'function' ? useProjection('permissions') : undefined;
      const value = ownerValue ?? (projected === undefined ? undefined
        : { currentValue: projected.currentValue, options: NATIVE_MODE_OPTIONS });
      const [status, setStatus] = useState(emptyStatus);
      const [menuOpen, setMenuOpen] = useState(false);
      const [dialogOpen, setDialogOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [statusError, setStatusError] = useState('');
      const [pick, setPick] = useState(null);
      const [confirmation, setConfirmation] = useState(null);
      const [acknowledged, setAcknowledged] = useState(false);
      const [ttlPick, setTtlPick] = useState(null);
      const [customTtl, setCustomTtl] = useState('');
      const [now, setNow] = useState(Date.now);
      const scope = useRef(null);
      const password = useRef(null);
      const clearPassword = () => { if (password.current) password.current.value = ''; };
      const valid = (life, version) => life.alive && scope.current === life && life.version === version;
      function accept(life, next) {
        life.status = next;
        life.pending = !next.modeActive && (next.state === 'pending' || next.state === 'authenticating');
        setStatus(next); setStatusError(''); setNow(Date.now());
        if (next.state === 'pending' && typeof next.requestId === 'string' && !life.dismissed.has(next.requestId)) {
          if (life.requestId !== next.requestId) { clearPassword(); setError(''); }
          life.requestId = next.requestId;
          life.intentId = next.requestId;
          setDialogOpen(true);
        } else {
          life.requestId = null;
          if (!life.pending) life.intentId = null;
          clearPassword(); setDialogOpen(false);
          setTtlPick(null); setCustomTtl('');
        }
      }
      function begin(life, action) {
        ++life.version;
        for (const controller of life.controllers) controller.abort();
        life.action = action;
        setBusy(true); setError(''); setMenuOpen(false);
        return life.version;
      }
      function finish(life, version) {
        if (valid(life, version)) { life.action = null; setBusy(false); setPick(null); }
      }

      useEffect(() => {
        const life = { sessionId, alive: true, version: 0, pending: false, requestId: null, intentId: null,
          action: null, controllers: new Set(), timers: new Set(), dismissed: new Set(), status: emptyStatus() };
        scope.current = life;
        setStatus(emptyStatus()); setMenuOpen(false); setDialogOpen(false); setBusy(false);
        setError(''); setStatusError(''); setPick(null); setConfirmation(null); setAcknowledged(false); clearPassword();
        setTtlPick(null); setCustomTtl('');
        let pollTimer;
        async function refresh() {
          if (!life.alive || !sessionId) return;
          const version = life.version;
          if (!life.action) {
            try {
              const next = await request(life, 'status', { sessionId });
              if (valid(life, version)) accept(life, next);
            } catch {
              if (valid(life, version)) {
                if (life.status.modeActive || life.pending || life.status.restorationPending) {
                  setStatus(emptyStatus()); setDialogOpen(false); clearPassword();
                  setStatusError(statusCheckError);
                } else setStatusError('');
              }
            }
          }
          if (life.alive) {
            setNow(Date.now());
            pollTimer = setTimeout(refresh, 1000);
          }
        }
        void refresh();
        return () => {
          life.alive = false; ++life.version;
          clearTimeout(pollTimer);
          for (const timer of life.timers) clearTimeout(timer);
          for (const controller of life.controllers) controller.abort();
          clearPassword();
          if (life.pending || life.action === 'authenticate') revokeOnDeparture(sessionId, life.intentId);
        };
      }, [sessionId]);
      useEffect(() => {
        if (dialogOpen && status.state === 'pending') password.current?.focus();
        if (!dialogOpen) clearPassword();
      }, [dialogOpen, status.requestId, status.state]);
      useEffect(() => {
        if (locked || value === undefined) {
          setMenuOpen(false); setAcknowledged(false); setConfirmation(null);
        }
      }, [locked, value]);

      // The native selector also renders nothing until the projection is available.
      if (value === undefined) return null;

      async function cancel(requestId) {
        const life = scope.current;
        if (!life?.alive || life.sessionId !== sessionId || !life.pending || !requestId || life.intentId !== requestId) return;
        // The dialog callback captures its rendered nonce, before any local clearing.
        life.dismissed.add(requestId);
        life.requestId = null;
        clearPassword(); setDialogOpen(false);
        const version = begin(life, 'cancel');
        try {
          await request(life, 'lock', { sessionId, requestId });
          if (!valid(life, version)) return;
          life.pending = false;
          const next = await request(life, 'status', { sessionId });
          if (valid(life, version)) accept(life, next);
        } catch {
          if (valid(life, version)) setError('无法确认取消操作。宿主仍会强制执行截止时间。');
        } finally { finish(life, version); }
      }
      async function submit(id) {
        const life = scope.current;
        if (!life?.alive || life.sessionId !== sessionId || life.action || locked) return;
        if (id === SUDO && life.status.restorationPending) return;
        const version = begin(life, id === SUDO ? 'sudo' : 'native');
        clearPassword(); setDialogOpen(false);
        if (life.requestId) life.dismissed.add(life.requestId);
        life.requestId = null; life.intentId = null;
        if (id === SUDO) {
          life.pending = true;
          setStatus({ ...life.status, modeActive: false });
        } else setPick(id);
        try {
          const ok = await command('/permission ' + id);
          // If departure won the race, no nonce was learned: never blind-cancel the session.
          if (!valid(life, version)) return;
          const next = await request(life, 'status', { sessionId });
          if (!valid(life, version)) return;
          accept(life, next);
          if (!ok) setError(id === SUDO ? '无法请求 Sudo 权限，请稍后重试。' : '无法切换访问模式。');
        } catch {
          if (valid(life, version)) {
            // A rejected command/status read supplied no cancellable nonce.
            setError(id === SUDO ? '无法请求 Sudo 权限，请稍后重试。' : '无法切换访问模式。');
          }
        } finally { finish(life, version); }
      }
      async function retune(seconds) {
        const life = scope.current;
        if (!life?.alive || life.sessionId !== sessionId || life.action || locked) return;
        if (!life.pending || !life.requestId) return;
        const limit = Math.max(30, Math.floor(life.status.maxTtlSeconds ?? 300));
        const value = Math.floor(Number(seconds));
        if (!Number.isInteger(value) || value < 30 || value > limit) {
          setError('时长需在 30–' + limit + ' 秒之间。');
          return;
        }
        // Re-enter the pending intent through the native command so the host
        // rebuilds the lease manifest with the chosen TTL; the old nonce dies.
        const version = begin(life, 'ttl');
        try {
          const ok = await command('/permission sudo-access ' + value);
          if (!valid(life, version)) return;
          const next = await request(life, 'status', { sessionId });
          if (!valid(life, version)) return;
          accept(life, next);
          if (!ok) { setTtlPick(null); setError('无法应用所选时长。'); }
          else if (next?.ttlSeconds !== value) {
            // Host still running the old 300-second bundle config: never pretend.
            setTtlPick(null); setError('宿主尚未应用该时长。请重启 dsh web 后再试。');
          }
        } catch {
          if (valid(life, version)) { setTtlPick(null); setError('无法应用所选时长。'); }
        } finally { finish(life, version); }
      }
      function choose(id) {
        setMenuOpen(false);
        if (locked || busy || confirmation !== null) return;
        if (id !== SUDO && !value?.options.some(option => option.value === id && id !== 'custom')) return;
        // Even an active Sudo reselection must pass through the native human command.
        if (id === SUDO) return submit(id);
        if (id === value.currentValue && !status.modeActive && !scope.current?.pending && !status.restorationPending) return;
        if (id === FULL_ACCESS && value.currentValue !== FULL_ACCESS) { setAcknowledged(false); setConfirmation(id); return; }
        return submit(id);
      }
      const closeConfirmation = () => { setAcknowledged(false); setConfirmation(null); };
      function confirmFullAccess() {
        if (locked || !acknowledged || confirmation === null) return;
        const id = confirmation;
        closeConfirmation();
        return submit(id);
      }
      async function authenticate(event) {
        event.preventDefault();
        const life = scope.current;
        if (!life?.alive || life.sessionId !== sessionId || life.action || life.status.state !== 'pending' || !life.requestId) return;
        const requestId = life.requestId;
        const version = begin(life, 'authenticate');
        // Uncontrolled DOM value only; clear before the asynchronous authentication POST.
        let secret = password.current?.value ?? '';
        clearPassword();
        try {
          const task = request(life, 'authenticate', { sessionId, requestId, password: secret }, 50_000);
          secret = undefined;
          await task;
          if (!valid(life, version) || life.requestId !== requestId) return;
          const next = await request(life, 'status', { sessionId });
          if (!valid(life, version) || life.requestId !== requestId) return;
          if (next.state === 'pending' && next.requestId !== requestId) {
            // Another human intent superseded this nonce while authentication was in flight.
            accept(life, next); return;
          }
          if (!next.modeActive) throw new Error(safeError());
          accept(life, next);
        } catch (failure) {
          if (valid(life, version) && life.requestId === requestId) {
            life.dismissed.add(requestId); life.requestId = null;
            setDialogOpen(false); setStatus({ ...life.status, state: 'locked', modeActive: false, requestId: undefined });
            // Inspect before cancellation: an old response must not revoke a newer nonce.
            // Never resubmit the password, including when its HTTP response was lost.
            try {
              let next = await request(life, 'status', { sessionId });
              if (!valid(life, version)) return;
              if (next.modeActive || (next.state === 'pending' && next.requestId !== requestId)) {
                accept(life, next); return;
              }
              if (next.state === 'pending' || next.state === 'authenticating') {
                await request(life, 'lock', { sessionId, requestId });
                if (!valid(life, version)) return;
                life.pending = false;
                next = await request(life, 'status', { sessionId });
              }
              if (valid(life, version)) accept(life, next);
            } catch { /* Fixed safe error below; no exception text or credentials. */ }
            if (valid(life, version)) setError(
              [safeError('password_required'), safeError('rate_limited')].includes(failure?.message) ? failure.message : safeError());
          }
        } finally { secret = undefined; finish(life, version); }
      }

      if (value === undefined) return null;
      // A session change may render before its effect runs; never borrow another session's status.
      const ownStatus = scope.current?.sessionId === sessionId ? status : emptyStatus();
      const remaining = Math.max(0, Math.ceil((ownStatus.expiresAt - now) / 1000));
      const active = ownStatus.modeActive === true && remaining > 0;
      const currentValue = active ? SUDO : pick ?? value.currentValue;
      const current = value.options.find(option => option.value === currentValue);
      const currentLabel = active ? 'Sudo 权限 · 剩余 ' + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0') : label(currentValue, current?.name ?? currentValue);
      const items = value.options.filter(option => option.value !== 'custom' && option.value !== SUDO).map(option => ({
        id: option.value, label: label(option.value, option.name), ...(glyphs.has(option.value) ? { icon: glyphs.get(option.value) } : {}),
      }));
      items.push({ id: SUDO, label: 'Sudo 权限', icon: glyphs.get(SUDO), disabled: !!ownStatus.restorationPending });
      const commands = ownStatus.selectedOperations ?? ownStatus.operations ?? [];
      const pending = ownStatus.state === 'pending' && dialogOpen && !!scope.current?.requestId;
      const maxTtl = Math.max(30, Math.floor(ownStatus.maxTtlSeconds ?? 300));
      const leaseTtl = ownStatus.ttlSeconds ?? Math.min(300, maxTtl);
      const ttlShown = ttlPick ?? ((leaseTtl === 300 || leaseTtl === 600 || leaseTtl === 900) ? leaseTtl : 'custom');
      return h(React.Fragment, null,
        h(Menu, { open: menuOpen, items, selectedId: currentValue, onSelect: choose, onClose: () => setMenuOpen(false), side: 'top', portal: true,
          anchor: h('button', { type: 'button', className: 'adb-trigger',
            'aria-label': '访问模式：' + currentLabel, title: current?.description,
            disabled: locked || busy || confirmation !== null, onClick: () => setMenuOpen(!menuOpen) },
          glyphs.has(currentValue) ? h('span', { className: 'adb-triggerIcon', 'aria-hidden': true }, glyphs.get(currentValue)) : null,
          h('span', { className: 'adb-triggerLabel' }, currentLabel),
          h('span', { className: 'adb-chevron' + (menuOpen ? ' adb-chevronOpen' : ''), 'aria-hidden': true }, h(IconChevronDownOutline14))) }),
        h(RiskConfirmation, { open: confirmation !== null, title: '启用完全访问？',
          description: '完全访问会减少确认步骤，让 agent 直接执行更多操作，包括敏感操作、文件修改或外部命令。请仅在你信任当前任务时使用。',
          acknowledgeLabel: '我了解风险并继续', cancelLabel: '取消', closeLabel: '关闭', confirmLabel: '启用完全访问',
          acknowledged, disabled: locked, onAcknowledgedChange: setAcknowledged, onCancel: closeConfirmation, onConfirm: confirmFullAccess }),
        ownStatus.restorationPending ? h('p', { role: 'alert' }, 'Sudo 权限已结束，但之前的文件系统模式未能恢复。请先选择一个普通访问模式，再重试 Sudo 权限。') : null,
        statusError ? h('p', { role: 'alert', style: { color: 'crimson' } }, statusError) : null,
        error ? h('p', { role: 'alert', style: { color: 'crimson' } }, error) : null,
        h(Modal, { open: dialogOpen && ownStatus.state === 'pending',
          onClose: () => { void cancel(ownStatus.requestId); },
          title: 'Sudo 权限', closeLabel: '关闭',
          className: 'adb-sudoDialog', contentClassName: 'adb-sudoContent',
          footer: h(React.Fragment, null,
            h(Button, { variant: 'outline', onClick: () => { void cancel(ownStatus.requestId); } }, '取消'),
            pending ? h(Button, { variant: 'primary', type: 'submit', form: 'adb-sudo-form', disabled: busy }, busy ? '认证中…' : '认证并进入 Sudo 权限') : null) },
          h('div', { className: 'adb-sudoBody' },
          h('p', { className: 'adb-meta' }, '会话：', h('code', null, sessionId)),
          h('p', { className: 'adb-note' }, '这会授予文件系统的完全访问权限：agent 可以减少确认步骤，修改或删除工作区之外的文件，并执行敏感的外部命令。root 命令权限见下文。更改无法自动撤销。请仅在你信任当前任务时继续。'),
          h('div', { className: 'adb-duration' },
            h('span', { className: 'adb-label' }, '认证时长'),
            h(SegmentedControl, { id: 'adb-duration', label: '认证时长', value: ttlShown, disabled: busy,
              options: [
                { value: 300, label: '5 分钟', disabled: maxTtl < 300 },
                { value: 600, label: '10 分钟', disabled: maxTtl < 600 },
                { value: 900, label: '15 分钟', disabled: maxTtl < 900 },
                { value: 'custom', label: '自定义' },
              ],
              onChange: nextTtl => {
                setTtlPick(nextTtl);
                if (nextTtl === 'custom') { setCustomTtl(String(ownStatus.ttlSeconds ?? Math.min(300, maxTtl))); return; }
                void retune(nextTtl);
              } }),
            ttlShown === 'custom'
              ? h('div', { className: 'adb-customTtl' },
                h(Input, { className: 'adb-ttlInput', type: 'number', min: 30, max: maxTtl, step: 30, value: customTtl,
                  'aria-label': '自定义认证时长（秒）',
                  onChange: event => setCustomTtl(event.target.value),
                  onBlur: () => {
                    if (customTtl.trim() === '') return;
                    const next = Math.min(maxTtl, Math.max(30, Math.floor(Number(customTtl))));
                    if (Number.isFinite(next)) void retune(next);
                  },
                  onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } } }),
                h('span', { className: 'adb-meta' }, '秒（30–' + maxTtl + ' 秒）'))
              : h('span', { className: 'adb-meta' }, '当前 ' + leaseTtl + ' 秒；最长 ' + maxTtl + ' 秒。每次重新选择都需要重新认证。')),
          ownStatus.allowAllCommands ? h('p', { className: 'adb-warning', role: 'alert' }, '允许所有命令：本会话的 agent 可以 root 身份执行任意 bash 命令，包括修改或删除任意系统文件、安装软件和启动服务。没有命令白名单。Sudo 权限结束后，命令效果和已分离的进程仍可能继续存在。') : null,
          h('p', { className: 'adb-note' }, '当需要 root 权限时，agent 可以请求打开此对话框。请求本身不会授予权限，只有你的认证才会。'),
          commands.length ? h('ul', { className: 'adb-ops' }, ...commands.map(op => h('li', { key: op.id },
            h('strong', null, op.id), ': ', op.label,
            h('pre', { className: 'adb-pre' }, ascii([op.executable, ...op.args])),
            h('small', null, '命令超时：', op.timeoutSeconds, ' 秒')))) : !ownStatus.allowAllCommands ? h('p', { className: 'adb-note' }, '未配置任何管理员操作。') : null,
          pending ? h('form', { id: 'adb-sudo-form', className: 'adb-form', onSubmit: authenticate, autoComplete: 'off' },
            h('label', { className: 'adb-label', htmlFor: 'adb-sudo-password' }, 'sudo 密码'),
            h(Input, { ref: password, id: 'adb-sudo-password', className: 'adb-password', type: 'password', autoComplete: 'off', maxLength: 4096,
              disabled: busy, spellCheck: false, placeholder: 'sudo 密码', 'aria-label': 'sudo 密码；不会被保存' }),
            h('p', { className: 'adb-meta' }, '密码只通过受信任的 Harness 宿主发送到本地 sudo 认证进程，不会被保存，也不会发送给模型。请勿在聊天中输入密码。')) : null)),
      );
    }
    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        // 0.2.0 already registers the native selector into this single slot at
        // priority 0; a negative priority shadows it while leaving it as the
        // fallback whenever this plugin is absent or unloaded.
        const commandFor = sessionId => async line => {
          try {
            const live = ctx.get('sessions')?.binding(sessionId)?.session;
            if (!live) return false;
            const result = await live.command(line);
            return result?.ok === true && result?.value?.matched === true;
          } catch { return false; }
        };
        ctx.slots.inject('conversation.input.permission', () => ctx.slots.register(
          { name: 'conversation.input.permission', id: 'admin-bridge', order: 50, priority: -1,
            inject: sessionId => ({ sessionId, command: commandFor(sessionId) }) },
          PermissionControl,
        ));
      },
    };
  },
});
