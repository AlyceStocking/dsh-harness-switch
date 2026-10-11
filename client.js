window.__ModuleLoader__.load({
  id: '@local/dsh-harness-switch',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;
    const en = {
      title: 'Model Harness', intro: 'Use Kimi in the native DSH conversation. Choose a harness for each model binding below, then select it in the normal model picker.',
      settings: 'Configuration', chat: 'Kimi conversation', executable: 'Kimi executable', home: 'Kimi configuration directory',
      homeHelp: 'Read endpoint, model and authentication from Kimi config.toml. No key is copied to plugin settings. Embedded core runs Kimi’s prompt, tools, Skills and compaction. Permissions appear in DSH. Stop the current turn before switching harnesses.',
      models: 'Read configured models', save: 'Save configuration', saved: 'Saved. Select the model in the native composer; changes apply to the next turn.',
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
      title: '模型 Harness', intro: '在 DSH 原生会话中使用 Kimi。为模型绑定选择 Harness 后，在原生模型选择器中切换；历史保留在当前会话。',
      settings: '连接配置', chat: 'Kimi 会话', executable: 'Kimi 可执行文件', home: 'Kimi 配置目录',
      homeHelp: '从 Kimi config.toml 读取端点、模型与认证，不复制密钥到插件配置。嵌入核心使用 Kimi 原生提示词、工具、Skills 与压缩；审批在 DSH 中显示。切换套装前先停止当前生成。',
      models: '读取已配置模型', save: '保存配置', saved: '已保存。在原生输入框中选择模型，配置从下一轮生效。',
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
          
          const [config, setConfig] = useState(null);
          const [harnesses, setHarnesses] = useState([]);
          const [models, setModels] = useState([]);
          const [binding, setBinding] = useState('');
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

          };
          useEffect(() => { live.current = true; run(reload); return () => { live.current = false; }; }, []);
          const button = (label, onClick, disabled = busy, extra = {}) => h('button', { type: 'button', onClick, disabled, ...extra }, label);
          const field = (label, value, change, extra = {}) => h('label', null, label, h('input', { value, onChange: e => change(e.target.value), ...extra }));
          const patch = value => setConfig(old => ({ ...old, ...value }));
          const updateBinding = (id, value) => patch({ bindings: config.bindings.map(b => b.id === id ? { ...b, ...value } : b) });
          const settingsView = config && h(React.Fragment, null,
            h('div', { className: 'hs-grid' }, field(t('home'), config.kimiHome, kimiHome => patch({ kimiHome }))),
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
            h('div', { className: 'hs-row' }, button(t('add'), () => patch({ bindings: [...config.bindings, { id: `model-${Date.now()}`, label: 'Kimi', model: '', harness: 'kimi-engine' }] })),
              button(t('save'), () => run(async () => { const saved = await rpc('settings/save', config); setConfig(saved); setBinding(saved.bindings[0].id); setNotice(t('saved')); }))));
          return h('section', { className: 'hs-panel' }, h('style', null, css), h('h3', null, t('title')), h('p', { className: 'hs-muted' }, t('intro')),
            error && h('div', { role: 'alert', className: 'hs-alert' }, `${t('error')}: ${error}`, button(t('retry'), () => run(reload))),
            notice && h('p', { role: 'status' }, notice), !config ? h('p', null, t('loading')) : settingsView);
        }
        function EngineTurnView({ callId, phase, block }) {
          phase ||= block?.kind === 'tool-result' ? 'result' : 'start';
          const [view, setView] = useState({ status: 'preparing', events: [] });
          const [failure, setFailure] = useState('');
          const id = block?.meta?.callId || callId;
          useEffect(() => {
            const controller = new AbortController(); let timer;
            async function refresh() {
              try {
                const value = await rpc('engine/view', { callId: id }, controller.signal);
                if (controller.signal.aborted) return;
                setView(value);
                if (!['completed', 'cancelled', 'failed'].includes(value.status) && phase !== 'result') timer = setTimeout(refresh, 500);
              } catch (e) { if (!controller.signal.aborted) setFailure(e.message); }
            }
            refresh();
            return () => { controller.abort(); clearTimeout(timer); };
          }, [id, phase]);
          const text = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
          const events = view.events || [];
          return h('section', { className: 'hs-panel', 'aria-label': 'Kimi Code' }, h('style', null, css),
            h('strong', null, `Kimi Code · ${view.status}`),
            failure && h('p', { role: 'alert' }, failure),
            view.kimiSessionId && h('small', { className: 'hs-muted' }, `${t('session')}: ${view.kimiSessionId}`),
            h('div', { className: 'hs-transcript' }, ...events.map((event, i) => {
              if (event.type === 'tool.call.started') return h('details', { key: i, className: 'hs-card' },
                h('summary', null, `${event.agentId && event.agentId !== 'main' ? event.agentId + ' · ' : ''}${event.name}`),
                h('pre', { className: 'hs-text' }, text(event.args)));
              if (event.type === 'tool.result') return h('details', { key: i },
                h('summary', null, `${events.find(e => e.toolCallId === event.toolCallId && e.name)?.name || t('tool')} · ${event.isError ? 'error' : 'result'}`),
                h('pre', { className: 'hs-text' }, text(event.output)));
              if (event.type === 'thinking.delta' || event.type === 'assistant.delta') return h('details', { key: i },
                h('summary', null, event.type === 'thinking.delta' ? t('thinking') : t('assistant')),
                h('pre', { className: 'hs-text' }, event.text));
              if (event.type.startsWith('compaction.') || event.type.startsWith('skill.')) return h('p', { key: i, className: 'hs-muted' }, `${event.type}${event.skillName ? ': ' + event.skillName : ''}`);
              return null;
            })),
            view.trimmed && h('p', { className: 'hs-muted' }, t('retained')),
            phase === 'result' && !events.length && h('pre', { className: 'hs-text' }, text(block?.content || '')));
        }
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'kimi_harness_turn', locale: 'harness-switch' }, EngineTurnView));
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'harness-switch', order: 70, label: () => t('title'), locale: 'harness-switch' }, Panel));
      },
    };
  },
});
