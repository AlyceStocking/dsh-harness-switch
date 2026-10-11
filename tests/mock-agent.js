import { Readable, Writable } from 'node:stream';
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
let cancel;
let count = 0;
agent({ name: 'fixture' })
  .onRequest(methods.agent.initialize, ({ params }) => {
    if (process.env.MOCK_CRASH === '1') process.exit(7);
    if (params.clientCapabilities.terminal || params.clientCapabilities.fs?.readTextFile || params.clientCapabilities.fs?.writeTextFile) throw new Error('Client must not replace Kimi tools');
    return { protocolVersion: PROTOCOL_VERSION, agentInfo: { name: 'Mock Kimi', version: 'test' }, agentCapabilities: { loadSession: true } };
  })
  .onRequest(methods.agent.session.new, ({ params }) => {
    if (params.mcpServers.length) throw new Error('Client must not inject DSH tools');
    return { sessionId: 'fixture-session' };
  })
  .onRequest(methods.agent.session.load, async ({ params, client }) => {
    await client.notify(methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'restored' } } });
    return {};
  })
  .onNotification(methods.agent.session.cancel, () => { cancel?.({ stopReason: 'cancelled' }); })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const text = params.prompt[0].text;
    const send = update => client.notify(methods.client.session.update, { sessionId: params.sessionId, update });
    if (text === 'hang') return new Promise(resolve => { cancel = resolve; });
    if (text === 'permission') {
      const result = await client.request(methods.client.session.requestPermission, {
        sessionId: params.sessionId, toolCall: { toolCallId: 'test-tool', title: 'Read file', kind: 'read', status: 'pending' },
        options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow once' }, { optionId: 'reject', kind: 'reject_once', name: 'Reject' }],
      });
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(result) } });
    } else {
      await send({ sessionUpdate: 'tool_call', toolCallId: `tool-${count}`, title: 'Read', kind: 'read', status: 'in_progress' });
      await send({ sessionUpdate: 'tool_call_update', toolCallId: `tool-${count}`, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'file contents' } }] });
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `turn ${++count}: ` } });
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
    }
    return { stopReason: 'end_turn' };
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
