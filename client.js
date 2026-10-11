window.__ModuleLoader__.load({
  id: '@local/dsh-harness-switch',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;
    const en = {
      title: 'Model Harness', intro: 'Kimi Code owns this conversation, its prompt, tools and history. Your usual DSH composer continues to use DSH.',
      settings: 'Configuration', chat: 'Kimi conversation', executable: 'Kimi executable', home: 'Kimi configuration directory',
      homeHelp: 'Reuse the same config.toml, skills and MCP settings as Kimi Code. API credentials stay in Kimi; no key is copied to this plugin.',
      models: 'Read configured models', save: 'Save configuration', saved: 'Saved. Existing sessions keep their original configuration.',
      add: 'Add model binding', remove: 'Remove', label: 'Display name', model: 'Kimi model alias', harness: 'Harness',
      cwd: 'Working directory (absolute path)', restore: 'Saved Kimi session ID (optional)', start: 'Connect',
      close: 'Disconnect', cancel: 'Stop', send: 'Send', prompt: 'Message to Kimi', permission: 'Kimi requests a decision', reject: 'Decline',
      empty: 'Connect to start a Kimi session.', loading: 'Loading…', error: 'Operation failed', retry: 'Reload',
      runtime: 'Runtime', session: 'Kimi session', retained: 'Older display content was trimmed. The full history remains in Kimi Code.',
      active: 'Active connections', reconnect: 'Open connection', modelHint: 'Use an alias from Kimi config, for example kimi-code/k3. Only installed harnesses appear here.',
      thinking: 'Thinking', user: 'You', assistant: 'Kimi', tool: 'Tool', starting: 'Starting', running: 'Running', idle: 'Ready', cancelling: 'Stopping', closed: 'Disconnected',
      plan: 'Plan', open: 'Open Model Harness', hide: 'Hide', invalid: 'Choose a model and working directory first.',
    };
    const zh = {
      title: '模型 Harness', intro: '此会话的提示词、工具与历史由 Kimi Code 管理。DSH 原有输入框仍使用 DSH。',
      settings: '连接配置', chat: 'Kimi 会话', executable: 'Kimi 可执行文件', home: 'Kimi 配置目录',
      homeHelp: '复用与 Kimi Code 相同的 config.toml、Skills 和 MCP 配置。API 凭据保留在 Kimi 中，插件不复制密钥。',
      models: '读取已配置模型', save: '保存配置', saved: '已保存。现有会话继续使用创建时的配置。',
      add: '添加模型绑定', remove: '移除', label: '显示名称', model: 'Kimi 模型别名', harness: 'Harness 套装',
      cwd: '工作目录（绝对路径）', restore: '恢复 Kimi 会话 ID（可选）', start: '连接', close: '断开连接', cancel: '停止', send: '发送',
      prompt: '发给 Kimi 的消息', permission: 'Kimi 请求你作出选择', reject: '拒绝', empty: '连接后开始 Kimi 会话。', loading: '加载中…',
      error: '操作失败', retry: '重新加载', runtime: '运行时', session: 'Kimi 会话',
      retained: '较早的显示内容已截断；完整历史仍保存在 Kimi Code 中。', active: '活动连接', reconnect: '打开连接',
      modelHint: '填写 Kimi 配置中的别名，例如 kimi-code/k3。列表仅显示已安装的 harness。',
      thinking: '思考', user: '你', assistant: 'Kimi', tool: '工具', starting: '启动中', running: '执行中', idle: '就绪', cancelling: '正在停止', closed: '已断开',
      plan: '计划', open: '打开模型 Harness', hide: '收起', invalid: '请先选择模型并填写工作目录。',
    };
    const css = `.hs-panel{color:var(--dsw-alias-label-primary);font:inherit;display:flex;flex-direction:column;gap:14px;padding:16px;min-width:0}.hs-panel *{box-sizing:border-box}.hs-panel p{margin:0;line-height:1.6}.hs-panel label{display:flex;flex-direction:column;gap:6px;font-size:13px}.hs-panel input,.hs-panel select,.hs-panel textarea,.hs-panel button{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:8px 10px}.hs-panel button{cursor:pointer}.hs-panel button:disabled{opacity:.5;cursor:default}.hs-panel button:focus-visible,.hs-panel input:focus-visible,.hs-panel textarea:focus-visible,.hs-panel select:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.hs-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.hs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.hs-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px}.hs-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.hs-transcript{max-height:45vh;overflow:auto;display:flex;flex-direction:column;gap:10px}.hs-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit;line-height:1.6}.hs-panel textarea{width:100%;resize:vertical;min-height:85px}.hs-dock{max-height:70vh;overflow:auto}.hs-alert{border-left:3px solid currentColor;padding:8px 12px}.hs-panel h3{margin:0;font-size:16px}.hs-panel small{overflow-wrap:anywhere}`;
    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('harness-switch', { en, zh }));
        const t = ctx.locale.bind('harness-switch');
        const rpc = async (endpoint, payload = {}, signal) => {
          const result = await ctx.connection.rpc.call('/harness-switch', endpoint, payload, signal);
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        };
        function Panel() {
          const [tab, setTab] = useState('chat');
          const [config, setConfig] = useState(null);
          const [harnesses, setHarnesses] = useState([]);
          const [models, setModels] = useState([]);
          const [binding, setBinding] = useState('');
          const [cwd, setCwd] = useState('');
          const [restore, setRestore] = useState('');
          const [session, setSession] = useState(null);
          const [active, setActive] = useState([]);
          const [message, setMessage] = useState('');
          const [busy, setBusy] = useState(false);
          const [error, setError] = useState('');
          const [notice, setNotice] = useState('');
          const live = useRef(true);
          const run = async fn => {
            setBusy(true); setError(''); setNotice('');
            try { await fn(); } catch (e) { if (live.current) setError(e.message); }
            finally { if (live.current) setBusy(false); }
          };
          const reload = async () => {
            const result = await rpc('settings/read');
            if (!live.current) return;
            setConfig(result.settings); setHarnesses(result.harnesses); setBinding(result.settings.bindings[0].id);
            const connections = await rpc('sessions/list'); if (live.current) setActive(connections);
          };
          useEffect(() => { live.current = true; run(reload); return () => { live.current = false; }; }, []);
          useEffect(() => {
            if (!session?.id) return;
            const controller = new AbortController();
            let revision = -1;
            (async () => {
              try {
                while (!controller.signal.aborted) {
                  const next = await rpc('sessions/read', { id: session.id, revision }, controller.signal);
                  if (controller.signal.aborted) break;
                  revision = next.revision;
                  setSession(old => old?.id === next.id && old.revision <= next.revision ? next : old);
                  if (next.status === 'closed') break;
                }
              } catch (e) { if (!controller.signal.aborted) setError(e.message); }
            })();
            return () => controller.abort();
          }, [session?.id]);
          const button = (label, onClick, disabled = busy, extra = {}) => h('button', { type: 'button', onClick, disabled, ...extra }, label);
          const field = (label, value, change, extra = {}) => h('label', null, label, h('input', { value, onChange: e => change(e.target.value), ...extra }));
          const patch = value => setConfig(old => ({ ...old, ...value }));
          const updateBinding = (id, value) => patch({ bindings: config.bindings.map(b => b.id === id ? { ...b, ...value } : b) });
          const settingsView = config && h(React.Fragment, null,
            h('div', { className: 'hs-grid' }, field(t('executable'), config.command, command => patch({ command })), field(t('home'), config.kimiHome, kimiHome => patch({ kimiHome }))),
            h('p', { className: 'hs-muted' }, t('homeHelp')),
            button(t('models'), () => run(async () => setModels(await rpc('models/read', { kimiHome: config.kimiHome })))),
            h('p', { className: 'hs-muted' }, t('modelHint')),
            ...config.bindings.map(b => h('div', { className: 'hs-card', key: b.id },
              h('div', { className: 'hs-grid' }, field(t('label'), b.label, label => updateBinding(b.id, { label })),
                models.length ? h('label', null, t('model'), h('select', { value: b.model, onChange: e => updateBinding(b.id, { model: e.target.value }) },
                  !models.some(m => m.alias === b.model) && h('option', { value: b.model }, b.model), ...models.map(m => h('option', { key: m.alias, value: m.alias }, `${m.label} · ${m.alias}`))))
                  : field(t('model'), b.model, model => updateBinding(b.id, { model })),
                h('label', null, t('harness'), h('select', { value: b.harness, onChange: e => updateBinding(b.id, { harness: e.target.value }) },
                  ...harnesses.map(hs => h('option', { key: hs.id, value: hs.id }, hs.label))))),
              button(t('remove'), () => patch({ bindings: config.bindings.filter(row => row.id !== b.id) }), busy || config.bindings.length === 1))),
            h('div', { className: 'hs-row' }, button(t('add'), () => patch({ bindings: [...config.bindings, { id: `model-${Date.now()}`, label: 'Kimi', model: '', harness: 'kimi-code' }] })),
              button(t('save'), () => run(async () => { const saved = await rpc('settings/save', config); setConfig(saved); setBinding(saved.bindings[0].id); setNotice(t('saved')); }))));
          const start = () => run(async () => {
            if (!binding || !cwd) throw new Error(t('invalid'));
            setSession(await rpc('sessions/start', { bindingId: binding, cwd, ...(restore.trim() ? { sessionId: restore.trim() } : {}) }));
            setActive(await rpc('sessions/list'));
          });
          const messages = session?.messages || [];
          const chatView = config && h(React.Fragment, null,
            !session || session.status === 'closed' ? h(React.Fragment, null,
              h('label', null, t('model'), h('select', { value: binding, onChange: e => setBinding(e.target.value) }, ...config.bindings.map(b => h('option', { key: b.id, value: b.id }, `${b.label} · ${b.harness}`)))),
              field(t('cwd'), cwd, setCwd), field(t('restore'), restore, setRestore), button(t('start'), start),
              active.length > 0 && h('div', { className: 'hs-card' }, h('strong', null, t('active')), ...active.map(a => button(`${t('reconnect')}: ${a.binding.label} · ${a.cwd}`, () => run(async () => setSession(await rpc('sessions/read', { id: a.id }))), busy, { key: a.id })))) :
              h(React.Fragment, null,
                h('div', { className: 'hs-row' }, h('strong', null, session.binding.label), h('span', null, t(session.status)),
                  button(t('cancel'), () => run(async () => setSession(await rpc('sessions/cancel', { id: session.id }))), busy || session.status !== 'running'),
                  button(t('close'), () => run(async () => { await rpc('sessions/close', { id: session.id }); setRestore(session.sessionId || ''); setCwd(session.cwd); setSession(null); setActive(await rpc('sessions/list')); }))),
                h('small', null, `${t('runtime')}: ${session.runtime?.name || 'Kimi'} ${session.runtime?.version || ''}`),
                h('small', null, `${t('session')}: ${session.sessionId || ''}`),
                session.error && h('p', { role: 'alert' }, session.error),
                session.trimmed && h('p', { className: 'hs-muted' }, t('retained')),
                h('div', { className: 'hs-transcript', 'aria-label': t('chat') }, ...messages.map(m => h('article', { className: 'hs-card', key: m.id },
                  h('strong', null, m.role === 'tool' ? `${m.title || t('tool')} · ${m.status || ''}` : t(m.role)),
                  m.role === 'thinking' ? h('details', null, h('summary', null, t('thinking')), h('pre', { className: 'hs-text' }, m.text)) : h('pre', { className: 'hs-text' }, m.text)))),
                session.plan && h('details', null, h('summary', null, t('plan')), ...session.plan.map((entry, i) => h('p', { key: i }, `${entry.status}: ${entry.content}`))),
                ...session.permissions.map(p => h('div', { key: p.id, className: 'hs-card', role: 'group', 'aria-label': t('permission') },
                  h('strong', null, t('permission')), h('p', null, p.toolCall.title),
                  h('pre', { className: 'hs-text' }, JSON.stringify(p.toolCall.rawInput || p.toolCall.content || {}, null, 2)),
                  h('div', { className: 'hs-row' }, ...p.options.map(o => button(o.name, () => run(() => rpc('sessions/permission', { id: session.id, requestId: p.id, optionId: o.optionId })), busy, { key: o.optionId })),
                    button(t('reject'), () => run(() => rpc('sessions/permission', { id: session.id, requestId: p.id, optionId: null })))))),
                h('form', { onSubmit: e => { e.preventDefault(); run(async () => { const next = await rpc('sessions/prompt', { id: session.id, text: message }); setSession(next); setMessage(''); }); } },
                  h('label', null, t('prompt'), h('textarea', { value: message, onChange: e => setMessage(e.target.value), disabled: busy || session.status !== 'idle' })),
                  h('button', { type: 'submit', disabled: busy || session.status !== 'idle' || !message.trim() }, t('send')))));
          return h('section', { className: 'hs-panel' }, h('style', null, css), h('h3', null, t('title')), h('p', { className: 'hs-muted' }, t('intro')),
            h('div', { className: 'hs-row' }, ...['chat', 'settings'].map(value => button(t(value), () => setTab(value), false, { key: value, 'aria-pressed': tab === value }))),
            error && h('div', { role: 'alert', className: 'hs-alert' }, `${t('error')}: ${error}`, button(t('retry'), () => run(reload))),
            notice && h('p', { role: 'status' }, notice), !config ? h('p', null, t('loading')) : tab === 'settings' ? settingsView : chatView);
        }
        function Dock() {
          const [open, setOpen] = useState(false);
          return h('div', { className: 'hs-dock' }, h('button', { type: 'button', onClick: () => setOpen(!open), 'aria-expanded': open }, t(open ? 'hide' : 'open')), open && h(Panel));
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'harness-switch', order: 70, label: () => t('title'), locale: 'harness-switch' }, Panel));
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'harness-switch', order: 70, locale: 'harness-switch' }, Dock));
      },
    };
  },
});
