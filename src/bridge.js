import { randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { SudoWorker } from './sudo-worker.js';
import { BridgeError, fail, identifier, integer, selectManifest, validateCommand, validateOperations } from './policy.js';

export class AdminBridge {
  constructor({ operations = [], maxTtlSeconds = 300, allowAllCommands = true } = {}, dependencies = {}) {
    this.operations = validateOperations(operations);
    if (typeof allowAllCommands !== 'boolean') fail('invalid_config', 'allowAllCommands 必须是布尔值。');
    Object.defineProperty(this, 'allowAllCommands', { value: allowAllCommands, enumerable: true });
    if (!integer(maxTtlSeconds, 30, 900)) fail('invalid_config', '最大租约时长必须为 30–900 秒。');
    this.maxTtlSeconds = maxTtlSeconds;
    this.workerFactory = dependencies.workerFactory ?? ((manifest, canProceed) => new SudoWorker(manifest, { canProceed }));
    this.now = dependencies.now ?? (() => performance.now());
    this.requestTimeoutMs = dependencies.requestTimeoutMs ?? 90_000;
    this.sessions = new Map();
    // Also revoke without waiting for the next tool/API call when policy changes.
    this.sweep = setInterval(() => {
      for (const id of this.sessions.keys()) this.check(id);
    }, 250);
    this.sweep.unref();
  }

  registerSession(sessionId, canApprove, onLock) {
    if (!identifier(sessionId) || typeof canApprove !== 'function' ||
        (onLock !== undefined && typeof onLock !== 'function') || this.sessions.has(sessionId))
      fail('invalid_session', '无法将管理员访问附加到此会话。');
    const record = { canApprove, onLock, lease: null, cooldownUntil: 0 };
    this.sessions.set(sessionId, record);
    return () => {
      if (this.sessions.get(sessionId) !== record) return;
      this.lock(sessionId);
      this.sessions.delete(sessionId);
    };
  }

  allowed(record) {
    try { return record.canApprove() === true; } catch { return false; }
  }

  check(sessionId) {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    if (record.lease && (!this.allowed(record) || this.now() >= record.lease.deadline)) this.lock(sessionId);
    return record;
  }

  requireAllowed(sessionId) {
    const record = this.check(sessionId);
    if (!record || !this.allowed(record)) fail('policy_denied', '必须启用会话审批；管理员访问被拒绝。');
    return record;
  }

  describe(sessionId) {
    const record = this.check(sessionId);
    if (!record) return { state: 'unavailable', operations: [], allowAllCommands: this.allowAllCommands, maxTtlSeconds: this.maxTtlSeconds };
    const enabled = this.allowed(record);
    const lease = record.lease;
    return {
      state: enabled ? (lease?.state ?? 'locked') : 'disabled',
      operations: this.operations,
      allowAllCommands: lease ? lease.manifest.allowAllCommands === true : this.allowAllCommands,
      maxTtlSeconds: this.maxTtlSeconds,
      ...(lease ? {
        selectedOperations: lease.manifest.operations,
        ttlSeconds: lease.manifest.ttlSeconds,
        expiresAt: Date.now() + Math.max(0, lease.deadline - this.now()),
        ...(lease.state === 'pending' ? { requestId: lease.requestId } : {}),
      } : {}),
    };
  }

  manifest(operationIds, ttlSeconds) {
    const manifest = selectManifest(this.operations, operationIds, ttlSeconds, this.maxTtlSeconds, this.allowAllCommands);
    if (Buffer.byteLength(JSON.stringify(manifest)) > 32768) fail('invalid_config', '所选操作清单超过 32 KiB。');
    return manifest;
  }

  // Trusted adapter only: creates a pending intent, never an authenticated grant.
  requestUnlock(sessionId, manifest, signal) {
    const record = this.requireAllowed(sessionId);
    if (signal?.aborted) fail('cancelled', '管理员请求已取消。');
    if (record.lease) fail('busy', '请先锁定当前管理员请求或租约，再开启新的请求。');
    if (this.now() < record.cooldownUntil) fail('rate_limited', '请稍候再请求认证。');
    if (manifest?.allowAllCommands === true && !this.allowAllCommands)
      fail('not_authorized', '配置已禁用任意命令。');
    manifest = selectManifest(this.operations, manifest?.operations?.map(op => op.id),
      manifest?.ttlSeconds, this.maxTtlSeconds, manifest?.allowAllCommands ?? false);
    if (Buffer.byteLength(JSON.stringify(manifest)) > 32768) fail('invalid_config', '所选操作清单超过 32 KiB。');
    const lease = {
      state: 'pending', manifest, requestId: randomUUID(), worker: null,
      deadline: this.now() + this.requestTimeoutMs,
    };
    record.lease = lease;
    return new Promise((resolve, reject) => {
      lease.resolve = resolve;
      lease.reject = reject;
      const abort = () => { if (record.lease === lease) this.lock(sessionId); };
      signal?.addEventListener('abort', abort, { once: true });
      lease.detach = () => signal?.removeEventListener('abort', abort);
      lease.timer = setTimeout(abort, this.requestTimeoutMs);
    });
  }

  async authenticate(sessionId, requestId, password) {
    const record = this.requireAllowed(sessionId);
    const lease = record.lease;
    if (!lease || lease.state !== 'pending' || typeof requestId !== 'string' ||
        Buffer.byteLength(requestId) !== Buffer.byteLength(lease.requestId) ||
        !timingSafeEqual(Buffer.from(requestId), Buffer.from(lease.requestId)))
      fail('stale_request', '此认证请求已过期或不可用。');
    if (typeof password !== 'string' || Buffer.byteLength(password) > 4096 || /[\r\n\0]/.test(password))
      fail('invalid_request', '密码输入无效。');
    lease.state = 'authenticating'; // Claim once before the first asynchronous boundary.
    record.cooldownUntil = this.now() + 10_000;
    try {
      lease.worker = this.workerFactory(lease.manifest, () =>
        record.lease === lease && this.allowed(record) && this.now() < lease.deadline);
      lease.worker.onClose = () => { if (record.lease === lease) this.lock(sessionId); };
      const authentication = lease.worker.authenticate(password);
      password = undefined;
      await authentication;
      // Policy and cancellation can change while PAM is prompting.
      this.requireAllowed(sessionId);
      if (record.lease !== lease) fail('cancelled', '管理员请求已取消。');
      clearTimeout(lease.timer);
      lease.detach();
      lease.state = 'unlocked';
      // Successful password authentication is not a failed-attempt throttle.
      // Reentry still needs a new worker/password; failed and cancelled attempts
      // retain their cooldown so repeated mode selection cannot bypass it.
      record.cooldownUntil = 0;
      // Root deadline started before ready; host starts here and can never extend root authority.
      lease.deadline = this.now() + lease.manifest.ttlSeconds * 1000;
      lease.timer = setTimeout(() => { if (record.lease === lease) this.lock(sessionId); }, lease.manifest.ttlSeconds * 1000);
      lease.resolve({ state: 'unlocked', operationIds: lease.manifest.operations.map(op => op.id), ttlSeconds: lease.manifest.ttlSeconds });
      lease.resolve = lease.reject = null;
      return { state: 'unlocked' };
    } catch (error) {
      if (record.lease === lease) this.lock(sessionId);
      else lease.worker?.close();
      if (error instanceof BridgeError && error.code === 'password_required')
        throw new BridgeError('password_required', 'Sudo 权限需要基于密码的 sudo 认证，不支持免密码 sudo。');
      throw new BridgeError('authentication_failed', '认证失败、已过期或已取消。');
    }
  }

  async run(sessionId, operationId, signal) {
    const record = this.requireAllowed(sessionId);
    const lease = record.lease;
    if (!lease || lease.state !== 'unlocked') fail('locked', '请先完成已批准的管理员请求认证。');
    if (!lease.manifest.operations.some(op => op.id === operationId)) fail('not_authorized', '此操作不在授权集合中。');
    if (signal?.aborted) { this.lock(sessionId); fail('cancelled', '管理员操作已取消。'); }
    const abort = () => { if (record.lease === lease) this.lock(sessionId); };
    signal?.addEventListener('abort', abort, { once: true });
    try { return await lease.worker.run(operationId); }
    finally { signal?.removeEventListener('abort', abort); }
  }

  async runCommand(sessionId, request, signal) {
    const record = this.requireAllowed(sessionId);
    const lease = record.lease;
    if (!lease || lease.state !== 'unlocked') fail('locked', '请先完成 Sudo 权限请求认证。');
    if (lease.manifest.allowAllCommands !== true) fail('not_authorized', '此租约未授权任意命令。');
    const command = validateCommand(request);
    if (signal?.aborted) { this.lock(sessionId); fail('cancelled', '管理员命令已取消。'); }
    const abort = () => { if (record.lease === lease) this.lock(sessionId); };
    signal?.addEventListener('abort', abort, { once: true });
    try { return await lease.worker.runCommand(command); }
    finally { signal?.removeEventListener('abort', abort); }
  }

  cancelRequest(sessionId, requestId) {
    if (this.sessions.get(sessionId)?.lease?.requestId === requestId) this.lock(sessionId);
  }

  lock(sessionId, reason = 'locked') {
    const record = this.sessions.get(sessionId);
    const lease = record?.lease;
    if (!lease) return { state: 'locked' };
    record.lease = null; // Clear authority before closing to prevent callback/reentrancy reuse.
    clearTimeout(lease.timer);
    lease.detach?.();
    lease.reject?.(new BridgeError('locked', '管理员请求已取消、已过期或被拒绝。'));
    try { lease.worker?.close(); }
    finally {
      // A composition owner may restore nonprivileged session state on every
      // termination path. Its failure can never retain or resurrect authority.
      try { record.onLock?.({ requestId: lease.requestId, reason }); } catch {}
    }
    return { state: 'locked' };
  }

  dispose() {
    clearInterval(this.sweep);
    for (const id of this.sessions.keys()) this.lock(id);
    this.sessions.clear();
  }
}
