import { randomUUID } from 'node:crypto';
import { AdminBridge } from './bridge.js';
import { SudoWorker } from './sudo-worker.js';
import { BridgeError, exactKeys, fail } from './policy.js';

export const SUDO_MODE = 'sudo-access';
export const SUDO_MODE_EVENT = 'admin-bridge/sudo-mode';
const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access'];
const HOOKS = ['capture', 'commitFull', 'restore', 'isUnchanged', 'isFull', 'isLive', 'audit'];

function snapshot(value) {
  exactKeys(value, ['preset', 'sandbox', 'approval']);
  if (typeof value.preset !== 'string' || !value.preset || value.preset === SUDO_MODE ||
      !SANDBOXES.includes(value.sandbox) || !['ask', 'never'].includes(value.approval))
    fail('invalid_session', '无法捕获本会话的原生权限模式。');
  return Object.freeze({ preset: value.preset, sandbox: value.sandbox, approval: value.approval });
}

// Knob writes and private rollback journal updates must be synchronous.
function sync(callback, ...args) {
  const result = callback(...args);
  if (result && typeof result.then === 'function') {
    Promise.resolve(result).catch(() => {});
    fail('invalid_session', 'Sudo 模式回调必须是同步的。');
  }
  return result;
}

/**
 * Ephemeral Sudo capability over the existing Full access preset. Neither the
 * preset nor the recovery journal grants root: only this exact live record and
 * its authenticated helper do. The raw bridge is deliberately not exported.
 *
 * Trusted command/tool adapters may prepare begin() intents. Only the protected
 * GUI password route authenticates them; no tool, preset or intent grants root.
 */
export class SudoMode {
  #bridge;
  #sessions = new Map();
  #closed = false;

  constructor(config = {}, dependencies = {}) {
    this.#bridge = new AdminBridge(config, {
      ...dependencies,
      workerFactory: dependencies.workerFactory ?? ((manifest, canProceed) =>
        new SudoWorker(manifest, { canProceed, requirePassword: true })),
    });
  }

  get operations() { return this.#bridge.operations; }
  get allowAllCommands() { return this.#bridge.allowAllCommands; }
  get maxTtlSeconds() { return this.#bridge.maxTtlSeconds; }
  manifest(ids, ttlSeconds) { return this.#bridge.manifest(ids, ttlSeconds); }

  /** Register the exact live agent identity and synchronous host-owned adapters. */
  registerSession(sessionId, hooks) {
    if (this.#closed || !hooks || !hooks.identity ||
        !['object', 'function'].includes(typeof hooks.identity) ||
        HOOKS.some(name => typeof hooks[name] !== 'function') ||
        (hooks.isDelegated !== undefined && typeof hooks.isDelegated !== 'function') ||
        this.#sessions.has(sessionId)) fail('invalid_session', '需要精确匹配的活动会话适配器。');
    const record = { hooks: { ...hooks }, mode: null, ownWrites: 0, retiring: false,
      restorationPending: false };
    const detach = this.#bridge.registerSession(sessionId,
      () => this.#allowed(record), info => this.#ended(record, info));
    this.#sessions.set(sessionId, record);
    return () => {
      if (this.#sessions.get(sessionId) !== record) return;
      record.retiring = true;
      this.lock(sessionId, 'session-disposed');
      detach();
      this.#sessions.delete(sessionId);
    };
  }

  register(sessionId, hooks) { return this.registerSession(sessionId, hooks); }

  #live(record) {
    try { return sync(record.hooks.isLive) === true; } catch { return false; }
  }

  #allowed(record) {
    const mode = record.mode;
    if (!mode || record.retiring || !this.#live(record)) return false;
    // A journal or preset replay never creates mode. This narrow suppression is
    // only for our own synchronous knob writes, never an asynchronous auth gap.
    if (record.ownWrites) return true;
    try {
      return mode.phase === 'active' ? sync(record.hooks.isFull) === true
        : sync(record.hooks.isUnchanged, mode.previous) === true;
    } catch { return false; }
  }

  #write(record, callback) {
    record.ownWrites++;
    try { return callback(); } finally { record.ownWrites--; }
  }

  #audit(record, mode, action, reason) {
    sync(record.hooks.audit, SUDO_MODE_EVENT, Object.freeze({
      action, generation: mode.generation, previous: mode.previous,
      ...(reason === undefined ? {} : { reason }),
    }));
  }

  /**
   * Create one password intent, not authority. identity cannot be supplied by a
   * JSON/model caller; the adapter supplies its captured, exact receiving agent.
   * The complete frozen operator scope and configured TTL are noneditable.
   */
  begin(sessionId, intent) {
    const record = this.#sessions.get(sessionId);
    if (!record || record.retiring || !this.#live(record) ||
        !['permission-command', 'agent-tool'].includes(intent?.source) || intent.identity !== record.hooks.identity)
      fail('invalid_session', '请在此活动会话的权限选择器中选择 Sudo 权限。');
    if (record.hooks.isDelegated && sync(record.hooks.isDelegated) !== false)
      fail('policy_denied', '被委派的会话不能进入 Sudo 权限。');
    if (record.restorationPending)
      fail('restoration_pending', 'root 权限已关闭，但无法确认之前的权限已恢复。请先恢复会话，再重试 Sudo 权限。');
    // Every explicit selection is a fresh entry, not renewal: remove old root,
    // restore the prior native mode, and obtain a new nonce/password. A failed
    // or cancelled password attempt still obeys the bridge's cooldown.
    if (record.mode) this.lock(sessionId, 'reentry');
    const previous = snapshot(sync(record.hooks.capture));
    // The GUI asks for a per-request duration; 5 minutes is the default even
    // when the operator raises maxTtlSeconds to allow longer sessions.
    const requestedTtl = intent.ttlSeconds ?? Math.min(300, this.maxTtlSeconds);
    if (!Number.isInteger(requestedTtl) || requestedTtl < 30 || requestedTtl > this.maxTtlSeconds)
      fail('invalid_request', `时长必须为 30–${this.maxTtlSeconds} 秒。`);
    const manifest = this.manifest(this.operations.map(op => op.id), requestedTtl);
    const mode = { phase: 'pending', previous, generation: randomUUID(), requestId: null,
      touched: false, preserveNative: false };
    record.mode = mode;
    try {
      const pending = this.#bridge.requestUnlock(sessionId, manifest);
      // The legacy bridge resolves this promise after authentication. Our own
      // authenticate() separately commits the permission transition first.
      pending.catch(() => {});
      mode.requestId = this.#bridge.describe(sessionId).requestId;
      if (!mode.requestId) fail('cancelled', 'Sudo 权限请求已取消。');
      return this.describe(sessionId);
    } catch (error) {
      this.lock(sessionId, 'entry-failed');
      throw error;
    }
  }

  async authenticate(sessionId, requestId, password) {
    const record = this.#sessions.get(sessionId);
    const mode = record?.mode;
    if (!mode || mode.phase !== 'pending' || mode.requestId !== requestId)
      fail('stale_request', '此认证请求已过期或不可用。');
    mode.phase = 'authenticating';
    try {
      const pending = this.#bridge.authenticate(sessionId, requestId, password);
      password = undefined;
      await pending;
      if (record.mode !== mode || !this.#allowed(record))
        fail('cancelled', '认证期间权限选择已改变。');
      this.#write(record, () => {
        // Persist rollback information BEFORE changing either native knob. A
        // crash after this update is recovery work, never a remembered grant.
        this.#audit(record, mode, 'enter');
        mode.touched = true;
        sync(record.hooks.commitFull, mode.previous);
        if (record.mode !== mode || !this.#live(record) || sync(record.hooks.isFull) !== true)
          fail('cancelled', '无法提交完全访问权限切换。');
        // The adapter records its post-write session.seq cutoff durably before
        // the root wrapper becomes active. Failure follows the same rollback path.
        this.#audit(record, mode, 'commit');
        if (record.mode !== mode || !this.#live(record) || sync(record.hooks.isFull) !== true)
          fail('cancelled', '无法完成完全访问权限切换。');
        mode.phase = 'active'; // Publish authority last, after all synchronous writes.
      });
      // Expiry/worker close can occur during any callback. The public projection
      // must not return success if checking the raw lease revokes this generation.
      const status = this.describe(sessionId);
      if (!status.modeActive) fail('cancelled', 'Sudo 权限在激活前已结束。');
      return { state: 'unlocked', modeActive: true };
    } catch (error) {
      if (record.mode === mode) this.lock(sessionId, 'authentication-failed');
      if (error instanceof BridgeError && error.code === 'password_required')
        throw new BridgeError('password_required', 'Sudo 权限需要基于密码的 sudo 认证，不支持免密码 sudo。');
      throw new BridgeError('authentication_failed', '认证失败、已过期或已取消。');
    } finally { password = undefined; }
  }

  async run(sessionId, operationId, signal) {
    const record = this.#sessions.get(sessionId);
    if (!record || record.mode?.phase !== 'active' || !this.describe(sessionId).modeActive)
      fail('locked', '请先使用 admin_request 或选择 Sudo 权限，并在 GUI 中完成认证。');
    return this.#bridge.run(sessionId, operationId, signal);
  }

  async runCommand(sessionId, request, signal) {
    const record = this.#sessions.get(sessionId);
    if (!record || record.mode?.phase !== 'active' || !this.describe(sessionId).modeActive)
      fail('locked', '请先使用 admin_request 或选择 Sudo 权限，并在 GUI 中完成认证。');
    return this.#bridge.runCommand(sessionId, request, signal);
  }

  describe(sessionId) {
    const record = this.#sessions.get(sessionId);
    const value = this.#bridge.describe(sessionId); // Rechecks independent deadline.
    const mode = record?.mode;
    const modeActive = mode?.phase === 'active' && value.state === 'unlocked';
    return {
      ...value,
      state: value.state === 'disabled' ? 'locked'
        : value.state === 'unlocked' && !modeActive ? 'authenticating' : value.state,
      modeActive,
      ...(record?.restorationPending ? { restorationPending: true } : {}),
      ...(mode ? { previousPreset: mode.previous.preset } : {}),
    };
  }

  /** Every ordinary permission selection calls lock BEFORE its original handler. */
  lock(sessionId, reason = 'locked') {
    const record = this.#sessions.get(sessionId);
    if (record?.mode) {
      const mode = record.mode;
      // Invalidate the wrapper before closing the helper or invoking restoration.
      record.mode = null;
      try { this.#bridge.lock(sessionId, reason); }
      finally { this.#restore(record, mode, reason); }
    } else this.#bridge.lock(sessionId, reason);
    return { state: 'locked', modeActive: false };
  }

  /** Match only the exact browser request, so stale disconnects cannot revoke a new entry. */
  cancelRequest(sessionId, requestId) {
    if (this.#sessions.get(sessionId)?.mode?.requestId === requestId)
      this.lock(sessionId, 'cancelled');
  }

  /** External native writes revoke root but preserve the newer native user choice. */
  observeNativeChange(sessionId) {
    const record = this.#sessions.get(sessionId);
    if (!record?.mode || record.ownWrites) return;
    record.mode.preserveNative = true;
    this.lock(sessionId, 'native-change');
  }

  #ended(record, { requestId, reason }) {
    const mode = record.mode;
    if (!mode || mode.requestId !== requestId) return;
    record.mode = null;
    this.#restore(record, mode, reason);
  }

  #restore(record, mode, reason) {
    if (!mode.touched) return; // Pending intent never changed native permissions.
    try {
      this.#write(record, () => {
        // A missed notification must not overwrite a newer native selection.
        if (mode.phase === 'active' && sync(record.hooks.isFull) !== true)
          mode.preserveNative = true;
        if (!mode.preserveNative) sync(record.hooks.restore, mode.previous);
        this.#audit(record, mode, 'exit', reason);
      });
    } catch (error) {
      // Root is already gone. Keep the unmatched journal for recovery and make
      // failed restoration visible rather than silently claiming a safe mode.
      record.restorationPending = true;
      throw error;
    }
  }

  dispose() {
    if (this.#closed) return;
    this.#closed = true;
    for (const [id, record] of this.#sessions) {
      record.retiring = true;
      try { this.lock(id, 'plugin-disposed'); } catch {}
    }
    this.#bridge.dispose();
    this.#sessions.clear();
  }
}
