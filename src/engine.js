import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NativeAdapter, PROVIDER } from './native.js';

export const ENGINE_HARNESS = 'kimi-engine';
export const ENGINE_TOOL = 'kimi_harness_turn';
export const ENGINE_COMMIT = 'c9f01f07388abc2cdca40c9c5267f58c65086710';
class EngineError extends Error {}
const hash = text => createHash('sha256').update(text).digest('hex');
const identity = { productName: 'dsh-harness-switch', version: '0.3.0', platform: 'dsh_harness_switch' };
const textOf = blocks => (blocks || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; } }
async function saveJson(path, data) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(tmp, path);
}

export function conversationForImport(messages, seen, currentId) {
  const known = new Set(seen);
  const own = new Set();
  let engineTurn = false;
  for (const message of messages) {
    if (message.role === 'user' && message.source?.kind === 'user') engineTurn = false;
    if (message.role === 'assistant' && message.source?.provider === PROVIDER && message.content.some(b => b.type === 'tool-call' && b.name === ENGINE_TOOL)) engineTurn = true;
    if (engineTurn) own.add(message.id);
  }
  const foreignCalls = new Set(messages.filter(m => !own.has(m.id))
    .flatMap(m => m.content || []).filter(b => b.type === 'tool-call').map(b => b.id));
  return messages.filter(m => m.id !== currentId && !known.has(m.id) && !own.has(m.id)).flatMap(m => {
    const content = (m.content || []).filter(b => b.type !== 'reasoning' && (
      m.role === 'assistant' ||
      (m.role === 'user' && ['user', 'compaction'].includes(m.source?.kind)) ||
      (b.type === 'tool-result' && foreignCalls.has(b.toolCallId))
    ));
    return content.length ? [{ role: m.role, content }] : [];
  });
}

export class EngineManager {
  constructor(ctx, store, directory, options = {}) {
    Object.assign(this, { ctx, store, directory });
    this.factory = options.factory || (async () => (await import('../vendor/engine/index.mjs')).createKimiHarness);
    this.hosts = new Map(); this.sessions = new Map(); this.running = new Map(); this.views = new Map(); this.closed = false; this.controllers = new Map();
  }
  async host(home) {
    if (this.closed) throw new EngineError('Kimi engine is stopping');
    const key = resolve(home);
    if (!this.hosts.has(key)) {
      const pending = this.factory().then(create => create({ homeDir: key, identity, uiMode: 'dsh' }));
      this.hosts.set(key, pending);
      pending.catch(() => this.hosts.delete(key));
    }
    return this.hosts.get(key);
  }
  async view(callId) {
    if (typeof callId !== 'string' || callId.length > 200) throw new EngineError('Invalid call id');
    return this.views.get(callId) || await readJson(join(this.directory, `view-${hash(callId)}.json`)) || { events: [], status: 'preparing' };
  }
  async approve(exec, request) {
    if (!this.ctx.approval || exec.signal.aborted) return { decision: 'cancelled' };
    const result = await this.ctx.approval.request({ agent: exec.agent, callId: exec.callId,
      toolName: `Kimi · ${request.toolName}`, reason: `${request.action}\n${JSON.stringify(request.display, null, 2)}`, signal: exec.signal });
    return { decision: result === 'allowed-once' ? 'approved' : result === 'cancelled' ? 'cancelled' : 'rejected' };
  }
  async question(exec, request) {
    if (!this.ctx.userQuestions || exec.signal.aborted) return null;
    const questions = request.questions.map((q, i) => ({ id: String(i), question: q.body ? `${q.question}\n${q.body}` : q.question,
      ...(q.header ? { header: q.header } : {}), options: [...q.options], multiSelect: q.multiSelect || false }));
    const result = await this.ctx.userQuestions.ask({ questions, agent: exec.agent, signal: exec.signal });
    if (exec.signal.aborted || !result.answers?.length) return null;
    const answers = {};
    for (const answer of result.answers) {
      const q = request.questions[Number(answer.id)];
      if (q) answers[q.question] = [ ...answer.selected, ...(answer.custom ? [answer.custom] : []) ].join(', ');
    }
    return { answers, method: 'enter' };
  }
  definition() {
    return {
      name: ENGINE_TOOL, description: 'Host transport for one embedded Kimi Code turn. This tool is scheduled by Harness Switch, not by the model.',
      parameters: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'], additionalProperties: false },
      output: { schema: { type: 'object', properties: { text: { type: 'string' }, transcript: { type: 'string' }, callId: { type: 'string' }, kimiSessionId: { type: 'string' } }, required: ['text', 'transcript', 'callId', 'kimiSessionId'], additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        presentationMeta: (_args, value) => ({ kind: ENGINE_HARNESS, callId: value.callId, kimiSessionId: value.kimiSessionId }),
      },
      execute: (args, exec) => this.run(args, exec),
    };
  }
  async run(args, exec) {
    if (!exec.agent || typeof args?.messageId !== 'string') throw new EngineError('Embedded Kimi requires an active DSH session');
    if (this.closed) throw new EngineError('Embedded Kimi is stopping');
    const id = String(exec.agent.session.id);
    if (this.running.has(id)) throw new EngineError('A Kimi turn is already active in this session');
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const job = this.execute(args, { ...exec, signal: AbortSignal.any([exec.signal, controller.signal]) });
    this.running.set(id, job);
    try { return await job; }
    catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError(exec.signal.aborted || controller.signal.aborted ? 'Kimi turn cancelled' : 'Kimi runtime failed. Check model configuration and local Kimi runtime logs.');
    } finally {
      const session = this.sessions.get(id);
      session?.setApprovalHandler(undefined); session?.setQuestionHandler(undefined);
      this.running.delete(id); this.controllers.delete(id);
    }
  }
  async execute(args, exec) {
    exec.signal.throwIfAborted();
    const native = exec.agent.session;
    const header = native.requestHeader()?.config;
    if (header?.provider !== PROVIDER) throw new EngineError('Kimi engine transport cannot be called by another provider');
    const settings = await this.store.read();
    const binding = settings.bindings.find(b => b.id === header.model && b.harness === ENGINE_HARNESS);
    if (!binding) throw new EngineError('The selected model is not an embedded Kimi binding');
    const history = native.deriveMessages();
    const message = history.find(m => m.id === args.messageId && m.role === 'user' && m.source?.kind === 'user');
    if (!message || message.content.some(b => b.type !== 'text')) throw new EngineError('Embedded bridge currently accepts text user messages only');
    const cwd = native.header?.cwd;
    if (!cwd) throw new EngineError('Select a DSH workspace before using the Kimi engine');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const linkFile = join(this.directory, `session-${hash(String(native.id))}.json`);
    let link = await readJson(linkFile);
    if (link && (link.home !== resolve(settings.kimiHome) || link.cwd !== cwd || link.commit !== ENGINE_COMMIT)) throw new EngineError('Kimi runtime location/version changed. Start a new DSH session to avoid reusing incompatible state.');
    if (link?.completed?.messageId === message.id) return link.completed.result;
    if (link?.pending === message.id) throw new EngineError('This Kimi turn was interrupted before its outcome was saved. It will not be run twice; send a new message to continue.');
    const host = await this.host(settings.kimiHome);
    let session = this.sessions.get(String(native.id));
    if (!session) {
      session = link ? await host.resumeSession({ id: link.kimiSessionId }) : await host.createSession({
        workDir: cwd, model: binding.model, thinking: header.reasoningEffort || 'high', permission: 'manual', drainAgentTasksOnStop: true,
        metadata: { dshSessionId: String(native.id), harnessSwitch: ENGINE_COMMIT },
      });
      this.sessions.set(String(native.id), session);
      link ||= { home: resolve(settings.kimiHome), cwd, commit: ENGINE_COMMIT, kimiSessionId: session.id, seen: [] };
      await saveJson(linkFile, link);
    }
    await session.setModel(binding.model);
    await session.setThinking(header.reasoningEffort || 'high');
    await session.setPermission('manual');
    session.setApprovalHandler(request => this.approve(exec, request));
    session.setQuestionHandler(request => this.question(exec, request));
    const trust = await host.getWorkspaceTrustInfo(cwd);
    if (!trust.trusted) {
      const answer = await this.approve(exec, { toolName: 'Workspace trust', action: 'Allow Kimi to load this workspace’s project instructions, Skills and configured MCP servers?', display: trust });
      if (answer.decision !== 'approved') throw new EngineError('Kimi workspace trust was declined');
      await host.trustWorkspace(cwd);
    }
    const imported = conversationForImport(history, link.seen, message.id);
    if (imported.length) {
      await session.importContext(JSON.stringify(imported), 'DSH conversation since the previous Kimi turn');
      link.seen = [...new Set([...link.seen, ...history.filter(m => m.id !== message.id).map(m => m.id)])];
      await saveJson(linkFile, link);
    }
    const input = textOf(message.content);
    const compact = /^\/kimi-compact(?:\s|$)/.test(input);
    const skill = /^\/kimi-skill\s+(\S+)(?:\s+([\s\S]*))?$/.exec(input);
    const view = { callId: exec.callId, kimiSessionId: session.id, status: 'running', events: [], commit: ENGINE_COMMIT };
    this.views.set(exec.callId, view);
    const done = Promise.withResolvers();
    let finalText = '', stepText = '', ended = false;
    const record = event => {
      // Kimi persists the full original wire journal; this is the bounded DSH display projection.
      if (event.type === 'assistant.delta' || event.type === 'thinking.delta') {
        const previous = view.events.at(-1);
        if (previous?.type === event.type && previous.agentId === event.agentId) previous.text = (previous.text + (event.delta || '')).slice(-131072);
        else view.events.push({ type: event.type, agentId: event.agentId, text: event.delta || '' });
      } else if (/^(tool\.(call.started|result|progress)|compaction\.|skill\.|turn\.(started|step.started|ended))/.test(event.type)) {
        view.events.push(JSON.parse(JSON.stringify(event)));
      }
      if (view.events.length > 2000) { view.events.splice(0, view.events.length - 2000); view.trimmed = true; }
      if (event.agentId && event.agentId !== 'main') return;
      if (event.type === 'turn.step.started') stepText = '';
      if (event.type === 'assistant.delta') { stepText += event.delta || ''; finalText = stepText; }
      if (event.type === 'turn.ended' && !compact) { ended = true; done.resolve(event.reason); }
      if (compact && /^compaction\.(completed|blocked|cancelled)$/.test(event.type)) {
        ended = true; finalText = event.type === 'compaction.completed' ? 'Kimi context compacted.' : 'Kimi compaction did not complete.';
        done.resolve(event.type === 'compaction.completed' ? 'completed' : 'blocked');
      }
    };
    const unsubscribe = session.onEvent(record);
    let cancelling;
    const cancel = () => {
      cancelling ||= Promise.allSettled([session.cancel(), session.cancelCompaction()]);
      done.resolve('cancelled');
    };
    exec.signal.addEventListener('abort', cancel, { once: true });
    try {
      link.pending = message.id;
      await saveJson(linkFile, link);
      exec.signal.throwIfAborted();
      if (compact) await session.compact({ instruction: input.replace(/^\/kimi-compact\s*/, '') || undefined });
      else if (skill) await session.promptWithSkills(skill[2] || `Use the ${skill[1]} skill.`, [{ name: skill[1], args: skill[2] || '' }]);
      else await session.prompt(input, { promptId: message.id });
      const reason = await done.promise;
      exec.signal.throwIfAborted();
      if (reason !== 'completed') throw new EngineError(`Kimi turn ended: ${reason}`);
      view.status = 'completed';
      const transcript = JSON.stringify(view.events.filter(e => e.type === 'tool.call.started' || e.type === 'tool.result' || e.type.startsWith('compaction.') || e.type.startsWith('skill.')));
      const result = { text: finalText || '(Kimi completed without a text reply.)', transcript, callId: exec.callId, kimiSessionId: session.id };
      link.seen = [...new Set([...link.seen, ...history.map(m => m.id)])];
      delete link.pending;
      link.completed = { messageId: message.id, result };
      await saveJson(linkFile, link);
      return result;
    } catch (error) {
      view.status = exec.signal.aborted ? 'cancelled' : 'failed';
      if (!ended) cancel();
      await cancelling;
      throw error;
    } finally {
      exec.signal.removeEventListener('abort', cancel);
      unsubscribe(); session.setApprovalHandler(undefined); session.setQuestionHandler(undefined);
      await saveJson(join(this.directory, `view-${hash(exec.callId)}.json`), view);
      this.views.delete(exec.callId);
    }
  }
  async dispose() {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.sessions.values()].map(s => s.cancel()));
    await Promise.allSettled(this.running.values());
    await Promise.allSettled([...this.hosts.values()].map(async h => (await h).close()));
    this.sessions.clear(); this.hosts.clear();
  }
}

async function* textResponse(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

export class EngineAdapter extends NativeAdapter {
  async snapshot(provider, model) {
    const prepared = await super.snapshot(provider, model);
    if (prepared.connection.harness === ENGINE_HARNESS) {
      // The outer route is a local transport, not a second model context. Kimi owns its context budget.
      const { context, ...info } = prepared.info;
      return { ...prepared, info };
    }
    return prepared;
  }
  async *generate(options, connection) {
    if (connection.harness !== ENGINE_HARNESS || options.purpose) { yield* super.generate(options, connection); return; }
    const messages = options.messages;
    const userIndex = messages.findLastIndex(m => m.role === 'user' && m.source?.kind === 'user');
    if (userIndex < 0) throw new EngineError('Embedded Kimi requires a user message');
    const tail = messages.slice(userIndex + 1);
    const call = tail.flatMap(m => m.source?.provider === PROVIDER ? m.content : []).findLast(b => b.type === 'tool-call' && b.name === ENGINE_TOOL);
    if (call) {
      const result = tail.flatMap(m => m.content).findLast(b => b.type === 'tool-result' && b.toolCallId === call.id);
      if (!result) throw new EngineError('Kimi turn transport is missing its tool result');
      if (result.isError) { yield* textResponse(`Kimi 执行未完成：${textOf(result.content)}`); return; }
      const parsed = JSON.parse(textOf(result.content));
      yield* textResponse(parsed.text); return;
    }
    const id = `kimi_${randomUUID().replaceAll('-', '')}`;
    const args = JSON.stringify({ messageId: messages[userIndex].id });
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name: ENGINE_TOOL, argumentsDelta: args };
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: ENGINE_TOOL, arguments: args } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}
