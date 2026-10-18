import { defineTool } from '@deepseek-ai/dsh-tools';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { exactKeys, fail, publicError } from './policy.js';

export const MODE_EVENT = 'admin-bridge/sudo-mode';
const NATIVE_EVENTS = new Set(['permission/preset', 'sandbox/mode', 'approval/policy']);
const MODES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const sameKnobs = (a, b) => a.sandbox === b.sandbox && a.approval === b.approval;

const output = {
  schema: { oneOf: [
    { type: 'object', additionalProperties: false, properties: {
      ok: { type: 'boolean', const: true, required: true },
      value: { type: 'json', required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      ok: { type: 'boolean', const: false, required: true },
      error: { type: 'object', additionalProperties: false, required: true, properties: {
        code: { type: 'string', required: true }, message: { type: 'string', required: true },
      } },
    } },
  ] },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

function validPrevious(value) {
  return value && typeof value === 'object' && Object.keys(value).length === 3 &&
    typeof value.preset === 'string' && value.preset.length > 0 && value.preset.length <= 128 &&
    MODES.has(value.sandbox) && ['ask', 'never'].includes(value.approval);
}

/** A private rollback journal is never authority and never enters DSH's log.
 * rc.1 rejects unknown persisted events and forbids append reentrancy, so a
 * custom session event is NOT a compatible persistence mechanism here. */
export function recoverMode(session, { capture, restore, nativeNames = [...MODES] }, journal) {
  const pending = journal.read(session.id);
  if (!pending) return;
  if (pending.sessionCreatedAt !== session.header?.createdAt) {
    journal.remove(session.id, pending.generation);
    return; // A reused ID is not the original session or permission intent.
  }
  // The journal is fsynced; DSH's own event log is buffered. A crash can leave
  // the latter behind, so an ahead-of-log commit cutoff is a partial commit.
  const commitSeq = pending.commitSeq !== null && pending.commitSeq <= session.seq
    ? pending.commitSeq : null;
  let newerChoice = false;
  const runs = new Map();
  const seen = new Set();
  const fullWrite = event => event.type === 'approval/policy' ? event.data.policy === 'never'
    : event.type === 'sandbox/mode' ? event.data.mode === 'danger-full-access'
      : event.data.preset === 'danger-full-access';
  for (let seq = pending.startSeq; seq < session.seq; seq++) {
    const event = session.eventAt(seq);
    if (!event) continue;
    if (event.type === 'command/run' && event.data.name === 'permission' &&
        typeof event.data.args === 'string' && nativeNames.includes(event.data.args.trim()))
      runs.set(event.data.commandId, true);
    if (event.type === 'command/done' && event.data.kind === 'success' && runs.has(event.data.commandId))
      newerChoice = true; // Includes explicit same-value native choices.
    if (!NATIVE_EVENTS.has(event.type)) continue;
    if (commitSeq !== null) {
      if (seq >= commitSeq) newerChoice = true;
    } else {
      // Without a commit marker, only an incomplete, nonrepeated Full-access
      // write prefix belongs to our transaction. Preserve any other native tail.
      if (!fullWrite(event) || seen.has(event.type)) newerChoice = true;
      seen.add(event.type);
    }
  }
  const current = capture();
  const partial = [pending.previous.sandbox, 'danger-full-access'].includes(current.sandbox) &&
    [pending.previous.approval, 'never'].includes(current.approval);
  if (!newerChoice && partial) restore(pending.previous);
  journal.remove(session.id, pending.generation);
}

/** Native adapters preserve the existing preset service and its three defaults. */
export function nativeCallbacks(ctx, agent, journal = ctx.get('adminBridgeJournal')) {
  const session = agent.session;
  const presets = ctx.get('permissionPresets');
  const sandbox = ctx.get('sandboxPolicy');
  const approval = ctx.get('approval');
  if (!presets || !sandbox || !approval || !journal)
    fail('unavailable', '原生权限模式或恢复存储不可用。');
  const capture = () => ({ preset: presets.current(session),
    sandbox: sandbox.resolve({ session }).mode,
    approval: approval.overrideOf(session) ?? approval.config.policy ?? 'ask' });
  const restore = previous => {
    if (!validPrevious(previous)) fail('invalid_session', '无法恢复之前的权限模式。');
    if (capture().sandbox !== previous.sandbox) setSandboxMode(session, previous.sandbox);
    if (capture().approval !== previous.approval) approval.setPolicy(agent, previous.approval);
    // Preserve a named preset only if its definition still matches the captured
    // knobs. A changed operator table must never broaden recovery permissions.
    let spec;
    try { spec = presets.resolve(previous.preset); } catch { /* derived custom */ }
    if (spec?.sandbox === previous.sandbox && spec.approval === previous.approval)
      presets.set(session, previous.preset);
  };
  const callbacks = {
    identity: agent, capture, restore,
    commitFull() {
      const full = presets.resolve('danger-full-access');
      if (full.sandbox !== 'danger-full-access' || full.approval !== 'never')
        fail('unavailable', 'Sudo 权限需要标准的完全访问预设。');
      // Called only after fresh human password authentication, including when
      // an agent requested the dialog. Requesting alone never grants authority.
      approval.setPolicy(agent, 'never');
      presets.set(session, 'danger-full-access');
    },
    isUnchanged: previous => {
      const current = capture();
      return sameKnobs(current, previous) && current.preset === previous.preset;
    },
    isFull: () => sameKnobs(capture(), { sandbox: 'danger-full-access', approval: 'never' }),
    isLive: () => ctx.get('agents')?.get(session.id) === agent,
    isDelegated: () => !session.header || session.header.origin === 'subagent' ||
      (session.header.delegationDepth ?? 0) > 0,
    nativeNames: presets.names,
    audit(type, data) {
      if (type !== MODE_EVENT) fail('invalid_session', '无效的恢复日志操作。');
      if (data.action === 'enter') {
        journal.write(session.id, { generation: data.generation, previous: data.previous,
          startSeq: session.seq, commitSeq: null, sessionCreatedAt: session.header.createdAt });
      } else if (data.action === 'commit') {
        const entry = journal.read(session.id);
        if (entry?.generation !== data.generation)
          fail('invalid_session', '进入模式期间恢复日志发生变化。');
        journal.write(session.id, { ...entry, commitSeq: session.seq });
      } else if (data.action === 'exit') journal.remove(session.id, data.generation);
      else fail('invalid_session', '无效的恢复日志操作。');
    },
  };
  recoverMode(session, callbacks, journal);
  return callbacks;
}

/** Session id of a candidate agent without assuming an exact live object. */
const session_id = candidate => candidate?.session?.id;

/** Human-authenticated mode with agent request/read/run/revoke tools. */
export function mountSession(ctx, agent, mode, journal = ctx.get('adminBridgeJournal')) {
  // DSH 0.1.5-rc.1 removed the `agent` context accessor, so liveness is read from
  // the `agents` registry instead of `ctx.agent`. `agent/created` is announced only
  // after the registry entry exists, so this is the same exact-identity check.
  if (!agent || ctx.get('agents')?.get(session_id(agent)) !== agent)
    fail('invalid_session', '需要精确匹配的活动 agent 作用域。');
  const session = agent.session;
  const sessionId = session.id;
  const tools = ctx.get('tools');
  const commands = ctx.get('commands');
  const original = commands?.find(agent, 'permission');
  if (!tools || !original) fail('unavailable', '原生权限命令不可用。');
  const callbacks = nativeCallbacks(ctx, agent, journal);
  const register = (name, description, parameters, required, run, optional = []) => tools.register(defineTool({
    name, description, parameters, output,
    async execute(args, exec) {
      try {
        if (exec.agent !== agent || exec.agent.session !== session)
          fail('invalid_session', '此工具属于另一个活跃会话。');
        exactKeys(args, required, optional);
        if (exec.signal.aborted) fail('cancelled', '管理员操作已取消。');
        return { ok: true, value: await run(args, exec) };
      } catch (error) { return { ok: false, error: publicError(error) }; }
    },
  }));
  return ctx.effect(function* () {
    yield mode.registerSession(sessionId, callbacks);
    yield ctx.on('session/event', (subject, event) => {
      if (subject === session && NATIVE_EVENTS.has(event.type)) mode.observeNativeChange(sessionId);
    });
    // Supported agent-local shadow: do not replace the global registry or the
    // permission service. Ordinary selections retain their original handler.
    yield commands.register({ ...original, recordInput: true,
      description: '切换权限模式：只读、工作区写入、完全访问，或需要密码认证的 Sudo 权限（可在后面附加秒数，如 sudo-access 600）',
      handler: async invocation => {
        if (invocation.agent !== agent || invocation.agent.session !== session)
          return { kind: 'error', text: '此权限选择器属于另一个会话。' };
        const [selected, ttlArg] = invocation.rawInput.trim().split(/\s+/);
        if (selected === 'sudo-access') {
          try {
            if (invocation.signal.aborted) fail('cancelled', '模式选择已取消。');
            const ttlSeconds = ttlArg === undefined || ttlArg === '' ? undefined : Number(ttlArg);
            mode.begin(sessionId, { source: 'permission-command', identity: agent,
              ...(ttlSeconds === undefined ? {} : { ttlSeconds }) });
            return { kind: 'success', text: '请在 Sudo 权限密码对话框中完成认证。认证成功前，之前的模式保持有效。' };
          } catch (error) { return { kind: 'error', text: publicError(error).message }; }
        }
        if (selected === '') {
          const status = mode.describe(sessionId);
          return { kind: 'success', text: `当前模式 ${status.modeActive ? 'sudo-access' : callbacks.capture().preset}（可用：${ctx.get('permissionPresets').names.join(', ')}、sudo-access）` };
        }
        if (ctx.get('permissionPresets').names.includes(selected)) {
          try { mode.lock(sessionId); }
          catch { /* Root is already revoked; never block a human's native-mode repair. */ }
        }
        return original.handler(invocation);
      },
    });
    yield register('admin_request',
      '当任务需要 root 权限时，主动请求 Sudo 权限。打开本会话的 GUI 密码对话框；在人类完成认证前不会授予权限。之后请检查 admin_status，再使用 admin_run。绝不要在聊天或工具中请求或接受密码；未经人类指示不要重复已取消的请求。',
      {}, [], () => {
        const current = mode.describe(sessionId);
        if (!current.modeActive && !['pending', 'authenticating'].includes(current.state))
          mode.begin(sessionId, { source: 'agent-tool', identity: agent });
        const { requestId: _browserOnly, ...status } = mode.describe(sessionId);
        return status;
      });
    yield register('admin_status',
      '读取本会话的 Sudo 权限模式与命令范围。如果需要 root 权限但尚未激活，请使用 admin_request 打开 GUI 认证对话框。只有人类密码认证才会授予权限；绝不要在聊天或工具中索要密码。',
      {}, [], () => {
        const { requestId: _browserOnly, ...status } = mode.describe(sessionId);
        return status;
      });
    yield register('admin_run',
      '在本会话已认证的 Sudo 权限下执行任意 root shell 命令。未激活时先调用 admin_request 并等待人类在 GUI 中认证。提供 command（bash 语法，无需 sudo 前缀），或使用旧版 operationId，二者不可同时提供。输出对模型可见；不要打印机密信息。离开 Sudo 会撤销授权，但不会撤销已完成的命令效果。',
      { command: { type: 'string', description: 'root bash 命令，最大 16 KiB。' },
        workdir: { type: 'string', description: 'command 的绝对工作目录；默认为 /。' },
        timeoutSeconds: { type: 'integer', description: '命令超时时间，1–120 秒；默认为 120。' },
        operationId: { type: 'string', description: '或者，使用已配置的操作 ID；不可再提供 command 相关选项。' } },
      [], (args, exec) => {
        if (Object.hasOwn(args, 'operationId')) {
          exactKeys(args, ['operationId']);
          return mode.run(sessionId, args.operationId, exec.signal);
        }
        exactKeys(args, ['command'], ['workdir', 'timeoutSeconds']);
        return mode.runCommand(sessionId, args, exec.signal);
      }, ['command', 'workdir', 'timeoutSeconds', 'operationId']);
    yield register('admin_lock',
      '离开 Sudo 权限或取消待处理的认证，撤销 root 授权，并恢复本会话之前的权限模式。不影响其他会话。',
      {}, [], () => mode.lock(sessionId));
  }, 'admin-bridge: password-gated mode, native selector command, and scoped tools');
}

// The former per-agent entry point (`apply`, published as `dsh-admin-bridge/session`)
// is intentionally gone. It read `ctx.agent`, the accessor DSH 0.1.5-rc.1 no longer
// installs on an agent context, so it could only throw. Nothing loads this subpath:
// the host composes per-agent scopes itself and passes the live agent explicitly
// (`src/index.js` -> `attach()` -> `mountSession(scope.ctx, agent, ...)`).
