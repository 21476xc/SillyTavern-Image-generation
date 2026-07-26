/**
 * ST-Custom-ImageGen
 * 自定义生图 (OpenAI 兼容)
 * 纯浏览器 ES Module，无打包依赖。
 *
 * Bootstrap 对齐官方第三方扩展：
 *   jQuery(async () => {
 *     const html = await renderExtensionTemplateAsync('third-party/<Folder>', 'settings');
 *     $('#extensions_settings2').append(html);
 *   });
 * 不在顶层静态 import ST 核心模块，避免命名导出变化导致整扩展静默失败。
 * 动态 import + window 回退；settings.html 优先按 import.meta.url 同目录加载。
 */

const MODULE_NAME = 'st-custom-imagegen';
const DISPLAY_NAME = '自定义生图 (OpenAI 兼容)';
const EXTENSION_VERSION = '1.1.6';
/** @type {string|null} */
let cachedExtensionRelativeName = null;
/** @type {any} */
let renderExtensionTemplateAsyncFn = null;
/** @type {boolean} */
let settingsInjectInFlight = false;
/** @type {boolean} */
let settingsRetryScheduled = false;

/** @type {any} */
let stGetContext = null;
/** @type {any} */
let extension_settings = {};
/** @type {any} */
let saveSettingsDebounced = null;
/** @type {any} */
let eventSource = null;
/** @type {any} */
let event_types = {};
/** @type {any} */
let saveChatConditional = null;
/** @type {any} */
let saveChatDebounced = null;
/** @type {any} */
let messageFormatting = null;
/** @type {any} */
let reloadCurrentChat = null;
/** @type {any} */
let setExtensionPrompt = null;
/** @type {any} */
let extension_prompt_types = null;
/** @type {any} */
let extension_prompt_roles = null;

function getExtensionScriptUrl() {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.url) {
            return String(import.meta.url);
        }
    } catch (_) { /* ignore */ }
    try {
        const scripts = Array.from(document.getElementsByTagName('script'));
        for (const s of scripts) {
            const src = s.src || '';
            if (/\/scripts\/extensions\/third-party\/[^/]+\/index\.js/i.test(src) && /imagegen|st-custom-imagegen|ST-Custom-ImageGen|SillyTavern-Image-generation/i.test(src)) {
                return src;
            }
        }
        for (const s of scripts) {
            const src = s.src || '';
            if (/\/scripts\/extensions\/third-party\/[^/]+\/index\.js/i.test(src)) {
                return src;
            }
        }
    } catch (_) { /* ignore */ }
    return '';
}

/**
 * ST 通过 GitHub 安装后目录名通常是仓库名：SillyTavern-Image-generation
 * 也可能是用户手动改过的 ST-Custom-ImageGen。设置模板路径必须与真实目录一致。
 * @returns {string} e.g. third-party/SillyTavern-Image-generation
 */
function getExtensionRelativeName() {
    if (cachedExtensionRelativeName) return cachedExtensionRelativeName;
    const scriptUrl = getExtensionScriptUrl();
    const m = String(scriptUrl).match(/\/scripts\/extensions\/(third-party\/[^/?#]+)\//i);
    if (m && m[1]) {
        cachedExtensionRelativeName = m[1];
        return cachedExtensionRelativeName;
    }
    // Fallback candidates ordered by GitHub install default folder name first
    cachedExtensionRelativeName = 'third-party/SillyTavern-Image-generation';
    return cachedExtensionRelativeName;
}

function getExtensionBasePath() {
    const scriptUrl = getExtensionScriptUrl();
    if (scriptUrl) {
        try {
            const u = new URL(scriptUrl, window.location?.href || 'http://127.0.0.1/');
            u.search = '';
            u.hash = '';
            let path = u.pathname || '';
            path = path.replace(/index\.js$/i, '');
            if (!path.endsWith('/')) path += '/';
            return path;
        } catch (_) {
            return String(scriptUrl).replace(/index\.js(?:\?.*)?$/i, '');
        }
    }
    // GitHub install default folder name
    return '/scripts/extensions/third-party/SillyTavern-Image-generation/';
}

function getExtensionFolderCandidates() {
    const rel = getExtensionRelativeName();
    const folder = rel.replace(/^third-party\//, '');
    return [...new Set([
        folder,
        'SillyTavern-Image-generation',
        'SillyTavern-Image-Generation',
        'ST-Custom-ImageGen',
        'st-custom-imagegen',
    ].filter(Boolean))];
}

async function loadSillyTavernApis() {
    const extCandidates = [];
    const scriptCandidates = [];
    try { extCandidates.push(new URL('../../../extensions.js', import.meta.url).href); } catch (_) { /* ignore */ }
    extCandidates.push('/scripts/extensions.js', '../../../extensions.js');
    try { scriptCandidates.push(new URL('../../../../script.js', import.meta.url).href); } catch (_) { /* ignore */ }
    scriptCandidates.push('/script.js', '../../../../script.js');

    let extMod = null;
    let scriptMod = null;
    const errors = [];

    for (const url of [...new Set(extCandidates)]) {
        try {
            extMod = await import(url);
            break;
        } catch (err) {
            errors.push(`extensions:${url}:${err?.message || err}`);
        }
    }
    for (const url of [...new Set(scriptCandidates)]) {
        try {
            scriptMod = await import(url);
            break;
        } catch (err) {
            errors.push(`script:${url}:${err?.message || err}`);
        }
    }

    stGetContext = extMod?.getContext || window.SillyTavern?.getContext || window.getContext || null;
    // 必须与 ST 使用同一 extension_settings 引用，否则保存无效且表现为“设置丢失”
    extension_settings = extMod?.extension_settings || window.extension_settings || extension_settings || {};
    saveSettingsDebounced = extMod?.saveSettingsDebounced || window.saveSettingsDebounced || null;
    renderExtensionTemplateAsyncFn = extMod?.renderExtensionTemplateAsync || window.renderExtensionTemplateAsync || null;

    eventSource = scriptMod?.eventSource || window.eventSource || null;
    event_types = scriptMod?.event_types || window.event_types || {};
    saveChatConditional = scriptMod?.saveChatConditional || window.saveChatConditional || null;
    saveChatDebounced = scriptMod?.saveChatDebounced || window.saveChatDebounced || null;
    messageFormatting = scriptMod?.messageFormatting || window.messageFormatting || null;
    reloadCurrentChat = scriptMod?.reloadCurrentChat || window.reloadCurrentChat || null;
    setExtensionPrompt = scriptMod?.setExtensionPrompt || window.setExtensionPrompt || null;
    extension_prompt_types = scriptMod?.extension_prompt_types || window.extension_prompt_types || null;
    extension_prompt_roles = scriptMod?.extension_prompt_roles || window.extension_prompt_roles || null;

    if (!extMod && !scriptMod) {
        console.warn(`[${MODULE_NAME}] ST API import failed, using window fallbacks only`, errors);
    } else if (errors.length) {
        console.log(`[${MODULE_NAME}] partial ST API import`, errors);
    }

    try {
        if (!window.extension_settings || typeof window.extension_settings !== 'object') {
            window.extension_settings = extension_settings || {};
        }
        // 若模块导出与 window 不是同一对象，优先跟随 window（ST 多数构建会挂到 window）
        // 但若只有模块导出，则回写到 window，便于其它脚本调试
        if (extMod?.extension_settings && typeof extMod.extension_settings === 'object') {
            extension_settings = extMod.extension_settings;
            window.extension_settings = extMod.extension_settings;
        } else {
            extension_settings = window.extension_settings;
        }
        if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
            extension_settings[MODULE_NAME] = {};
        }
    } catch (_) { /* ignore */ }

    return { extMod, scriptMod, errors };
}
const IMAGE_PROMPT_RE = /<image_prompt>\s*([\s\S]*?)\s*<\/image_prompt>/i;

const DEFAULT_MAIN_INJECTION = [
    '你正在进行角色扮演。除正常叙事外，当本回合出现明确、可绘制的画面时，请在正文末尾追加 1 个生图提示词块。',
    '',
    '规则：',
    '1. 先完整输出角色扮演正文，不要中断剧情，不要用 OOC 解释生图。',
    '2. 仅当有清晰可画的一帧画面时才追加提示词块；无新画面则不要输出块。',
    '3. 优先使用 XML 标签（推荐）：',
    '<image_prompt>',
    'subject, appearance, clothing, pose, expression, setting, lighting, camera angle, art style, quality tags',
    '</image_prompt>',
    '4. 也可使用围栏代码块（二选一，不要两种都写）：',
    '```stcig-prompt',
    '1girl, red coat, standing in rain, neon street, wet asphalt reflections, cinematic lighting',
    '```',
    '5. 块内只写纯画面提示词：以英文短语为主，逗号分隔；不要对话、不要解释、不要假装已经出图。',
    '6. 内容应具体可视：人物外观与服装、姿态表情、环境道具、光影与构图。',
    '7. 同一条回复最多 1 个提示词块。',
    '8. 角色名：{{char}}；用户名：{{user}}。',
    '{{sfw_constraint}}',
].join('\n');

const DEFAULT_EXTRACTOR_SYSTEM = [
    '你是专业的 AI 绘画提示词提取器。',
    '任务：阅读角色扮演对话与最新消息，提炼“一张”最能代表当前关键画面的生图提示词。',
    '输出要求：',
    '1. 只输出最终提示词本身：不要解释、标题、引号、markdown 代码围栏、XML 标签。',
    '2. 以英文短语为主，逗号分隔；专有名词/角色独特称呼可保留原文。',
    '3. 结构建议：主体 → 外观/发型/五官 → 服装/配饰 → 动作/表情 → 环境/背景/道具 → 构图/镜头 → 光影/氛围/画质。',
    '4. 总长度约 40–120 个英文词；信息密度高，避免空泛形容词堆砌。',
    '5. 忽略 OOC、系统指令、与画面无关的 meta 讨论；不要复述整段对白。',
    '6. 若多画面并存，选择叙事焦点最强、最值得定格的一帧。',
    '7. 若原文几乎无可视信息，可基于文本合理补全一个得体、可画的场景，但仍需贴合角色与情境。',
    '8. 不要输出 negative prompt（负向提示词由扩展另行拼接）。',
    '{{sfw_constraint}}',
].join('\n');

const DEFAULT_SFW_CONSTRAINT = [
    'Keep the image strictly SFW / safe-for-work.',
    'No nudity, no sexual content, no explicit anatomy, no gore.',
    'Clothing must remain modest and fully covering.',
].join(' ');

const DEFAULT_SENSITIVE_WORDS = [
    'nude', 'naked', 'nsfw', 'sex', 'sexual', 'erotic', 'porn', 'xxx',
    '裸', '色情', '性爱', '露点', '下流',
].join(', ');

const DEFAULT_SETTINGS = {
    enabled: true,
    autoGenerate: true,
    onlyAiMessages: true,
    stripTagsFromDisplay: true,
    insertAsMarkdown: true,
    showMessageButtons: true,
    apiBaseUrl: 'https://api.openai.com',
    apiKey: '',
    apiModel: 'dall-e-3',
    apiEndpoint: '/v1/images/generations',
    size: '1024x1024',
    quality: 'standard',
    style: '',
    n: 1,
    responseFormat: 'url',
    extraBodyJson: '',
    sendNegativeAsField: true,
    promptMode: 'main',
    mainInjectionPrompt: DEFAULT_MAIN_INJECTION,
    mainInjectionDepth: 0,
    mainInjectionPosition: 'in_prompt',
    extractorBaseUrl: '',
    extractorApiKey: '',
    extractorModel: 'gpt-4o-mini',
    extractorEndpoint: '/v1/chat/completions',
    extractorSystemPrompt: DEFAULT_EXTRACTOR_SYSTEM,
    extractorTemperature: 0.4,
    extractorMaxTokens: 400,
    extractorUseMainCredentials: true,
    promptPrefix: '',
    promptSuffix: '',
    negativePrompt: '',
    sfwEnabled: false,
    sfwConstraint: DEFAULT_SFW_CONSTRAINT,
    sfwSensitiveWords: DEFAULT_SENSITIVE_WORDS,
    sfwReplaceWith: '[sfw]',
    cooldownMs: 3000,
    maxAutoPerChat: 0,
    timeoutMs: 120000,
    manualPrompt: '',
    autoCountByChat: {},
};

/** @type {typeof DEFAULT_SETTINGS} */
let settings = { ...DEFAULT_SETTINGS };
let lastAutoGenAt = 0;
let generating = false;
/** Prevent double init / double event binding in ST reloads. */
let extensionInitialized = false;
let eventsBound = false;
const processedMessageKeys = new Set();
const inFlightMessageKeys = new Set();
/** @type {{ messageIndex: number, fp: string, reason: string } | null} */
let pendingAutoJob = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let pendingAutoTimer = null;
/** Last successfully injected prompt text (avoid noisy re-logs). */
let lastInjectedPromptText = null;
const logLines = [];
const MAX_LOG = 80;
const MAX_PROCESSED_KEYS = 400;
const MAX_AUTO_COUNT_ENTRIES = 200;

function getContextSafe() {
    try {
        if (typeof stGetContext === 'function') return stGetContext();
    } catch (_) { /* ignore */ }
    if (typeof window.getContext === 'function') {
        try { return window.getContext(); } catch (_) { /* ignore */ }
    }
    return {
        chat: window.chat || [],
        characters: window.characters || [],
        groups: window.groups || [],
        name1: window.name1 || 'User',
        name2: window.name2 || 'Character',
        characterId: window.this_chid ?? null,
        groupId: window.selected_group ?? null,
    };
}

function toast(type, message, title = DISPLAY_NAME) {
    try {
        if (window.toastr && typeof window.toastr[type] === 'function') {
            window.toastr[type](message, title, { timeOut: type === 'error' ? 8000 : 4000 });
            return;
        }
    } catch (_) { /* ignore */ }
    console[type === 'error' ? 'error' : 'log'](`[${title}] ${message}`);
}

function ensureSettingsBucket() {
    if (!extension_settings || typeof extension_settings !== 'object') return;
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
        extension_settings[MODULE_NAME] = {};
    }
}

function saveSettings() {
    ensureSettingsBucket();
    extension_settings[MODULE_NAME] = { ...settings };
    const fn = typeof saveSettingsDebounced === 'function'
        ? saveSettingsDebounced
        : window.saveSettingsDebounced;
    try { fn?.(); } catch (_) { /* ignore */ }
}

function deepMerge(base, extra) {
    const out = { ...base };
    if (!extra || typeof extra !== 'object') return out;
    for (const [k, v] of Object.entries(extra)) {
        if (
            v && typeof v === 'object' && !Array.isArray(v)
            && typeof base[k] === 'object' && base[k] && !Array.isArray(base[k])
        ) {
            out[k] = deepMerge(base[k], v);
        } else if (v !== undefined) {
            out[k] = v;
        }
    }
    return out;
}

function clampInt(value, min, max, fallback) {
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function normalizeEnum(value, allowed, fallback) {
    const v = String(value ?? '').trim();
    return allowed.includes(v) ? v : fallback;
}

function pruneAutoCountMap(maxEntries = MAX_AUTO_COUNT_ENTRIES) {
    const map = settings.autoCountByChat;
    if (!map || typeof map !== 'object') {
        settings.autoCountByChat = {};
        return;
    }
    const keys = Object.keys(map);
    if (keys.length <= maxEntries) return;
    const overflow = keys.length - maxEntries;
    for (let i = 0; i < overflow; i++) {
        delete map[keys[i]];
    }
}

function loadSettings() {
    ensureSettingsBucket();
    const saved = extension_settings[MODULE_NAME] || {};
    settings = deepMerge({ ...DEFAULT_SETTINGS }, saved);
    settings.n = clampInt(settings.n, 1, 4, 1);
    settings.cooldownMs = clampInt(settings.cooldownMs, 0, 600000, 3000);
    settings.maxAutoPerChat = clampInt(settings.maxAutoPerChat, 0, 9999, 0);
    settings.timeoutMs = clampInt(settings.timeoutMs, 5000, 600000, 120000);
    settings.mainInjectionDepth = clampInt(settings.mainInjectionDepth, 0, 99, 0);
    settings.extractorTemperature = clampNumber(settings.extractorTemperature, 0, 2, 0.4);
    settings.extractorMaxTokens = clampInt(settings.extractorMaxTokens, 32, 4000, 400);
    settings.promptMode = normalizeEnum(settings.promptMode, ['main', 'extractor'], 'main');
    settings.responseFormat = normalizeEnum(settings.responseFormat, ['url', 'b64_json', 'auto'], 'url');
    settings.mainInjectionPosition = normalizeEnum(
        settings.mainInjectionPosition,
        ['in_prompt', 'in_chat'],
        'in_prompt',
    );
    settings.apiBaseUrl = String(settings.apiBaseUrl || '').trim();
    settings.apiModel = String(settings.apiModel || '').trim();
    settings.apiEndpoint = String(settings.apiEndpoint || '').trim() || '/v1/images/generations';
    settings.extractorBaseUrl = String(settings.extractorBaseUrl || '').trim();
    settings.extractorModel = String(settings.extractorModel || '').trim();
    settings.extractorEndpoint = String(settings.extractorEndpoint || '').trim() || '/v1/chat/completions';
    settings.size = String(settings.size || '').trim();
    if (!settings.autoCountByChat || typeof settings.autoCountByChat !== 'object') {
        settings.autoCountByChat = {};
    }
    pruneAutoCountMap();
}

function safeStringify(value) {
    try {
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
}

function log(level, message, detail) {
    const ts = new Date().toLocaleTimeString();
    const line = detail
        ? `[${ts}] ${level.toUpperCase()}: ${message} | ${safeStringify(detail)}`
        : `[${ts}] ${level.toUpperCase()}: ${message}`;
    logLines.push(line);
    while (logLines.length > MAX_LOG) logLines.shift();
    refreshLogPanel();
    if (level === 'error') console.error(`[${MODULE_NAME}]`, message, detail ?? '');
    else console.log(`[${MODULE_NAME}]`, message, detail ?? '');
}

function $(id) {
    return document.getElementById(id);
}

function chatKey() {
    const ctx = getContextSafe();
    if (ctx.groupId) return `group:${ctx.groupId}`;
    if (ctx.characterId !== undefined && ctx.characterId !== null) return `char:${ctx.characterId}`;
    return 'unknown';
}

function buildSettingsHtml() {
    // Fallback only: preferred path is settings.html via renderExtensionTemplateAsync
    return `
<div id="stcig_settings" class="stcig-settings">
  <div class="stcig-section">
    <h4>总控</h4>
    <div class="stcig-status-bar">
      <span id="stcig_status_badge" class="stcig-badge off">已关闭</span>
      <span id="stcig_mode_badge" class="stcig-badge">模式: main</span>
      <span id="stcig_sfw_badge" class="stcig-badge">SFW: 关</span>
    </div>
    <div class="stcig-row">
      <label class="stcig-inline-check"><input type="checkbox" id="stcig_enabled"> 启用扩展</label>
      <label class="stcig-inline-check"><input type="checkbox" id="stcig_autoGenerate"> 自动生图</label>
      <label class="stcig-inline-check"><input type="checkbox" id="stcig_onlyAiMessages"> 仅 AI 消息</label>
      <label class="stcig-inline-check"><input type="checkbox" id="stcig_stripTagsFromDisplay"> 剥离展示中的标签</label>
      <label class="stcig-inline-check"><input type="checkbox" id="stcig_insertAsMarkdown"> 以 Markdown 插入图片</label>
      <label class="stcig-inline-check"><input type="checkbox" id="stcig_showMessageButtons"> 消息按钮</label>
    </div>
  </div>
  <div class="stcig-section">
    <h4>生图 API</h4>
    <div class="stcig-row">
      <label class="stcig-field"><span>Base URL</span><input type="text" id="stcig_apiBaseUrl"></label>
      <label class="stcig-field"><span>API Key</span><input type="password" id="stcig_apiKey"></label>
      <label class="stcig-field"><span>Model（可下拉 / 可手输）</span><div class="stcig-model-picker"><select id="stcig_apiModel_select" class="stcig-model-select" aria-label="生图模型列表"><option value="">（获取列表后可下拉选择）</option></select><input type="text" id="stcig_apiModel" placeholder="可手输任意模型名" autocomplete="off"></div><div id="stcig_model_fetch_hint" class="stcig-hint">可用「获取模型列表」或「测试连接」拉取模型</div></label>
      <label class="stcig-field"><span>Endpoint</span><input type="text" id="stcig_apiEndpoint"></label>
    </div>
    <div class="stcig-actions">
      <div class="menu_button" id="stcig_btn_save">保存设置</div>
      <div class="menu_button" id="stcig_btn_fetch_models">获取模型列表</div>
      <div class="menu_button" id="stcig_btn_test">测试连接并获取模型</div>
    </div>
  </div>
  <div class="stcig-section">
    <h4>手动生成 / 日志</h4>
    <textarea id="stcig_manual_prompt" placeholder="直接输入提示词并生成"></textarea>
    <div class="stcig-actions">
      <div class="menu_button" id="stcig_btn_manual">生成图片</div>
      <div class="menu_button" id="stcig_btn_from_last">从最近 AI 回复提取并生成</div>
      <div class="menu_button" id="stcig_btn_reset_count">重置当前聊天自动计数</div>
      <div class="menu_button" id="stcig_btn_clear_log">清空日志</div>
      <div class="menu_button" id="stcig_btn_reset_templates">恢复默认模板</div>
      <div class="menu_button" id="stcig_btn_load_prompt_defaults">载入 prompts.js 默认</div>
    </div>
    <div id="stcig_log" class="stcig-log">（暂无日志）</div>
  </div>
</div>`.trim();
}

function findSettingsHost() {
    // 官方第三方扩展优先挂到 #extensions_settings2，其次 #extensions_settings
    const selectors = [
        '#extensions_settings2',
        '#extensions_settings',
        '#extensions_settings2 .extensions_block',
        '#extensions_settings .extensions_block',
        '#rm_extensions_block',
    ];
    for (const sel of selectors) {
        try {
            const host = document.querySelector(sel);
            if (host) return host;
        } catch (_) { /* ignore */ }
    }
    return null;
}

function getMountedSettingsRoot() {
    const byId = document.getElementById(`${MODULE_NAME}-settings`);
    if (byId) return byId;
    const hosted = document.querySelector('#extensions_settings2 [data-stcig="1"], #extensions_settings [data-stcig="1"], #rm_extensions_block [data-stcig="1"], #stcig_fallback_host [data-stcig="1"]');
    if (hosted) return hosted;
    const inner = document.getElementById('stcig_settings');
    if (inner) {
        const root = inner.closest('[data-stcig="1"], .stcig-settings-root, .extension_container') || inner;
        // 只有已经挂在扩展设置区/兜底区时才视为存在，避免“假阳性”跳过注入
        if (inner.closest('#extensions_settings2, #extensions_settings, #rm_extensions_block, #stcig_fallback_host, #sheld')) {
            return root;
        }
    }
    return null;
}

function settingsPanelExists() {
    return !!getMountedSettingsRoot();
}

/**
 * 若面板已挂在次优容器，而官方首选 #extensions_settings2 已出现，则迁移过去。
 * 手机端常见：先出现 extensions_settings，稍后才挂 settings2。
 */
function relocateSettingsPanelIfNeeded() {
    const root = getMountedSettingsRoot();
    if (!root) return false;
    const preferred = document.getElementById('extensions_settings2');
    if (!preferred) return false;
    if (preferred.contains(root)) return false;
    try {
        preferred.appendChild(root);
        log('info', '设置面板已迁移到 #extensions_settings2');
        return true;
    } catch (err) {
        log('warn', '设置面板迁移失败', err?.message || err);
        return false;
    }
}

function buildSettingsWrapper(html) {
    const wrap = document.createElement('div');
    wrap.className = 'extension_container stcig-settings-root';
    wrap.id = `${MODULE_NAME}-settings`;
    wrap.dataset.stcig = '1';
    wrap.innerHTML = `
      <div class="inline-drawer wide100p">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>${DISPLAY_NAME}</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <div class="stcig-hint" style="margin-bottom:8px;opacity:.85;">
            在这里配置生图 API。安装后请先在「扩展 → 管理扩展」中确认本扩展已启用。
          </div>
          ${html}
        </div>
      </div>
    `;
    return wrap;
}

async function loadSettingsTemplateHtml() {
    const names = [
        getExtensionRelativeName(),
        ...getExtensionFolderCandidates().map((f) => `third-party/${f}`),
    ];
    const uniq = [...new Set(names.filter(Boolean))];
    const errors = [];

    // 0) 与 index.js 同目录（GitHub 安装后最稳，不依赖目录名猜测）
    const localCandidates = [];
    try { localCandidates.push(new URL('./settings.html', import.meta.url).href); } catch (_) { /* ignore */ }
    try {
        const base = getExtensionBasePath();
        if (base) localCandidates.push(`${base}settings.html`);
    } catch (_) { /* ignore */ }
    for (const url of [...new Set(localCandidates.filter(Boolean))]) {
        try {
            const resp = await fetch(url, { cache: 'no-cache' });
            if (!resp.ok) {
                errors.push(`${url}: HTTP ${resp.status}`);
                continue;
            }
            const html = await resp.text();
            if (html && html.trim() && /stcig|st-custom-imagegen|生图/i.test(html)) {
                log('info', `settings 模板已本地加载: ${url}`);
                return html;
            }
        } catch (err) {
            errors.push(`local:${url}:${err?.message || err}`);
        }
    }

    // 1) Official ST API: renderExtensionTemplateAsync('third-party/<Folder>', 'settings')
    if (typeof renderExtensionTemplateAsyncFn === 'function') {
        for (const name of uniq) {
            try {
                const html = await renderExtensionTemplateAsyncFn(name, 'settings');
                if (html && String(html).trim()) {
                    log('info', `settings 模板已加载: ${name}/settings.html`);
                    return String(html);
                }
            } catch (err) {
                errors.push(`${name}: ${err?.message || err}`);
            }
        }
    }

    // 2) fetch fallback (third-party 与部分用户目录都映射在 /scripts/extensions/)
    for (const name of uniq) {
        try {
            const url = `/scripts/extensions/${name}/settings.html`;
            const resp = await fetch(url, { cache: 'no-cache' });
            if (!resp.ok) {
                errors.push(`${url}: HTTP ${resp.status}`);
                continue;
            }
            const html = await resp.text();
            if (html && html.trim()) {
                log('info', `settings 模板已 fetch: ${url}`);
                return html;
            }
        } catch (err) {
            errors.push(`${name}/fetch: ${err?.message || err}`);
        }
    }

    log('warn', 'settings.html 未能加载，使用内置精简面板', errors.slice(0, 8));
    return null;
}

function mountSettingsNode(node, { allowBodyFallback = false } = {}) {
    if (!node) return false;
    if (settingsPanelExists()) {
        bindSettingsUi();
        syncUiFromSettings();
        updateStatusBadges();
        updateModeVisibility();
        return true;
    }

    const host = findSettingsHost();
    if (!host) {
        if (!allowBodyFallback) {
            log('warn', '扩展设置容器尚未就绪，稍后重试注入');
            return false;
        }
        let fallback = document.getElementById('stcig_fallback_host');
        if (!fallback) {
            fallback = document.createElement('div');
            fallback.id = 'stcig_fallback_host';
            fallback.style.cssText = 'padding:12px;margin:8px;border:1px solid #666;border-radius:8px;z-index:9999;position:relative;';
            (document.querySelector('#sheld') || document.body).appendChild(fallback);
            log('warn', '未找到扩展设置容器，已挂到页面兜底区域（请仍到“扩展”页查找）');
        }
        fallback.appendChild(node);
    } else {
        // 官方写法：$('#extensions_settings2').append(html)
        try {
            if (typeof jQuery === 'function') {
                jQuery(host).append(node);
            } else {
                host.appendChild(node);
            }
        } catch (_) {
            host.appendChild(node);
        }
        log('info', '设置面板已注入扩展设置页', host.id || host.className || host.tagName);
    }

    bindSettingsUi();
    syncUiFromSettings();
    updateStatusBadges();
    updateModeVisibility();
    return true;
}

async function injectSettingsPanel({ allowBodyFallback = false } = {}) {
    if (settingsPanelExists()) {
        relocateSettingsPanelIfNeeded();
        bindSettingsUi();
        return true;
    }
    if (settingsInjectInFlight) return false;
    settingsInjectInFlight = true;
    try {
        let templateHtml = null;
        try {
            templateHtml = await loadSettingsTemplateHtml();
        } catch (err) {
            log('warn', '加载 settings 模板异常', err?.message || err);
        }

        // await 期间可能已有并发注入完成
        if (settingsPanelExists()) {
            bindSettingsUi();
            return true;
        }

        let node = null;
        if (templateHtml) {
            const wrap = document.createElement('div');
            wrap.innerHTML = String(templateHtml).trim();
            // 跳过前导空白/注释文本节点
            node = wrap.querySelector?.(`#${MODULE_NAME}-settings, [data-stcig="1"], .stcig-settings-root, #stcig_settings`)
                || wrap.firstElementChild
                || wrap;
            if (!node.id) node.id = `${MODULE_NAME}-settings`;
            node.dataset.stcig = '1';
            if (!node.classList.contains('extension_container')) {
                node.classList.add('extension_container');
            }
            if (!node.classList.contains('stcig-settings-root')) {
                node.classList.add('stcig-settings-root');
            }
        } else {
            node = buildSettingsWrapper(buildSettingsHtml());
        }

        return mountSettingsNode(node, { allowBodyFallback });
    } finally {
        settingsInjectInFlight = false;
    }
}

function scheduleSettingsPanelRetry() {
    if (settingsRetryScheduled) return;
    settingsRetryScheduled = true;
    let tries = 0;
    const maxTries = 60;
    const tick = async () => {
        if (settingsPanelExists()) {
            relocateSettingsPanelIfNeeded();
            return;
        }
        tries += 1;
        const ok = await injectSettingsPanel({ allowBodyFallback: tries >= maxTries });
        if (ok) return;
        if (tries < maxTries) {
            setTimeout(() => { void tick(); }, tries < 10 ? 300 : 500);
        }
    };
    setTimeout(() => { void tick(); }, 200);

    try {
        let obsTimer = null;
        const obs = new MutationObserver(() => {
            if (settingsPanelExists()) {
                relocateSettingsPanelIfNeeded();
                // 面板已存在且位于首选容器时停止观察，避免长时间空转
                const preferred = document.getElementById('extensions_settings2');
                const root = getMountedSettingsRoot();
                if (preferred && root && preferred.contains(root)) {
                    obs.disconnect();
                }
                return;
            }
            if (!findSettingsHost()) return;
            if (obsTimer) return;
            obsTimer = setTimeout(() => {
                obsTimer = null;
                void injectSettingsPanel({ allowBodyFallback: false }).then((ok) => {
                    if (ok) obs.disconnect();
                });
            }, 100);
        });
        obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
        // 手机端扩展抽屉可能很晚才挂载，观察更久一点
        setTimeout(() => { try { obs.disconnect(); } catch (_) { /* ignore */ } }, 120000);
    } catch (_) { /* ignore */ }

    // 页面重新可见时再尝试一次（移动端切后台/回前台）
    try {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !settingsPanelExists()) {
                void injectSettingsPanel({ allowBodyFallback: false });
            }
        });
    } catch (_) { /* ignore */ }
}

function openSettingsPanel() {
    void injectSettingsPanel({ allowBodyFallback: true }).then(() => {
        const el = getMountedSettingsRoot()
            || document.getElementById(`${MODULE_NAME}-settings`)
            || document.getElementById('stcig_settings')
            || document.querySelector('[data-stcig="1"]');
        if (!el) {
            toast('warning', '仍未找到设置面板，请打开「扩展」页并向下滚动查找。');
            return;
        }
        try {
            // 尽量先打开 ST 扩展页相关抽屉
            const extTab = document.querySelector('#extensions_button, .extensions_button, [data-i18n="Extensions"], #rm_button_extensions');
            extTab?.click?.();
        } catch (_) { /* ignore */ }
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const content = el.querySelector?.('.inline-drawer-content');
            const toggle = el.querySelector?.('.inline-drawer-toggle');
            if (content && getComputedStyle(content).display === 'none') {
                toggle?.click?.();
            } else if (el.querySelector?.('.inline-drawer') && content && content.offsetHeight === 0) {
                toggle?.click?.();
            }
        } catch (_) { /* ignore */ }
        toast('info', '已定位到设置面板');
    });
}

function ensureWandMenuButton() {
    try {
        const menu = document.getElementById('extensionsMenu')
            || document.querySelector('.extensions_menu');
        if (!menu) return false;
        if (document.getElementById('stcig_wand_button')) return true;

        const btn = document.createElement('div');
        btn.id = 'stcig_wand_button';
        btn.className = 'list-group-item flex-container flexGap5 interactable';
        btn.title = DISPLAY_NAME;
        btn.tabIndex = 0;
        btn.innerHTML = `<div class="fa-solid fa-image extensionsMenuExtensionButton"></div><span>${DISPLAY_NAME}</span>`;
        btn.addEventListener('click', (e) => {
            e.preventDefault?.();
            e.stopPropagation?.();
            openSettingsPanel();
        });
        menu.appendChild(btn);
        log('info', '已添加扩展魔杖菜单入口');
        return true;
    } catch (err) {
        log('warn', '添加魔杖菜单失败', err?.message || err);
        return false;
    }
}

function scheduleWandMenuButton() {
    if (ensureWandMenuButton()) return;
    let tries = 0;
    const timer = setInterval(() => {
        tries += 1;
        if (ensureWandMenuButton() || tries >= 30) clearInterval(timer);
    }, 1000);
}
function bindSettingsUi() {
    const root = (typeof getMountedSettingsRoot === 'function' ? getMountedSettingsRoot() : null)
        || document.getElementById(`${MODULE_NAME}-settings`)
        || document.getElementById('stcig_settings');
    if (!root) return;
    if (root.dataset && root.dataset.stcigBound === '1') return;
    if (root.dataset) root.dataset.stcigBound = '1';

    // Model fields use dedicated select + text input handlers for mobile-friendly picking.
    const ids = [
        'enabled', 'autoGenerate', 'onlyAiMessages', 'stripTagsFromDisplay', 'insertAsMarkdown', 'showMessageButtons',
        'apiBaseUrl', 'apiKey', 'apiEndpoint', 'size', 'quality', 'style', 'n', 'responseFormat', 'extraBodyJson', 'sendNegativeAsField',
        'promptMode', 'mainInjectionPrompt', 'mainInjectionDepth', 'mainInjectionPosition',
        'extractorUseMainCredentials', 'extractorBaseUrl', 'extractorApiKey', 'extractorEndpoint',
        'extractorSystemPrompt', 'extractorTemperature', 'extractorMaxTokens',
        'promptPrefix', 'promptSuffix', 'negativePrompt',
        'sfwEnabled', 'sfwConstraint', 'sfwSensitiveWords', 'sfwReplaceWith',
        'cooldownMs', 'maxAutoPerChat', 'timeoutMs',
    ];

    for (const key of ids) {
        const el = $(`stcig_${key}`);
        if (!el) continue;
        const eventName = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(eventName, () => {
            readUiIntoSettings();
            saveSettings();
            applyExtensionPromptInjection();
            updateStatusBadges();
            updateModeVisibility();
        });
    }

    $('stcig_manual_prompt')?.addEventListener('input', () => {
        settings.manualPrompt = $('stcig_manual_prompt').value;
        saveSettings();
    });

    $('stcig_btn_save')?.addEventListener('click', () => {
        readUiIntoSettings();
        saveSettings();
        applyExtensionPromptInjection();
        toast('success', '设置已保存');
        log('info', '设置已保存');
    });

    bindModelPickerUi('apiModel', 'apiModel');
    bindModelPickerUi('extractorModel', 'extractorModel');

    $('stcig_btn_fetch_models')?.addEventListener('click', () => { void fetchModelsOnly(); });
    $('stcig_btn_test')?.addEventListener('click', () => { void testConnection(); });
    $('stcig_btn_manual')?.addEventListener('click', () => {
        const prompt = ($('stcig_manual_prompt')?.value || '').trim();
        if (!prompt) {
            toast('warning', '请先输入提示词');
            return;
        }
        void generateAndInsert({ prompt, source: 'manual', messageIndex: null });
    });
    $('stcig_btn_from_last')?.addEventListener('click', () => {
        void generateFromLastAiMessage({ force: true });
    });
    $('stcig_btn_reset_count')?.addEventListener('click', () => {
        const key = chatKey();
        settings.autoCountByChat[key] = 0;
        saveSettings();
        toast('info', '当前聊天自动计数已重置');
        log('info', `重置自动计数: ${key}`);
    });
    $('stcig_btn_clear_log')?.addEventListener('click', () => {
        logLines.length = 0;
        refreshLogPanel();
    });
    $('stcig_btn_reset_templates')?.addEventListener('click', () => {
        applyPromptDefaults({ forceTemplates: true, forcePrefix: false });
        syncUiFromSettings();
        applyExtensionPromptInjection();
        toast('success', '已恢复提示词模板默认值');
        log('info', '已恢复提示词模板默认值');
    });
    $('stcig_btn_load_prompt_defaults')?.addEventListener('click', () => {
        applyPromptDefaults({ forceTemplates: false, forcePrefix: true });
        syncUiFromSettings();
        toast('success', '已填入 prefix / suffix / negative 默认');
        log('info', '已填入 prefix/suffix/negative 默认');
    });
}

function readUiIntoSettings() {
    // Fallback to current setting when an input is absent (e.g. minimal built-in panel),
    // otherwise a save from the reduced panel would wipe fields it does not render.
    const bool = (id, cur) => { const el = $(id); return el ? !!el.checked : !!cur; };
    const val = (id, cur) => { const el = $(id); return el ? el.value : cur; };
    const num = (id, fallback) => {
        const el = $(id);
        if (!el) return fallback;
        const n = Number(el.value);
        return Number.isFinite(n) ? n : fallback;
    };

    settings.enabled = bool('stcig_enabled', settings.enabled);
    settings.autoGenerate = bool('stcig_autoGenerate', settings.autoGenerate);
    settings.onlyAiMessages = bool('stcig_onlyAiMessages', settings.onlyAiMessages);
    settings.stripTagsFromDisplay = bool('stcig_stripTagsFromDisplay', settings.stripTagsFromDisplay);
    settings.insertAsMarkdown = bool('stcig_insertAsMarkdown', settings.insertAsMarkdown);
    settings.showMessageButtons = bool('stcig_showMessageButtons', settings.showMessageButtons);

    settings.apiBaseUrl = String(val('stcig_apiBaseUrl', settings.apiBaseUrl) ?? '').trim();
    settings.apiKey = val('stcig_apiKey', settings.apiKey) ?? '';
    settings.apiModel = String(val('stcig_apiModel', settings.apiModel) ?? '').trim();
    settings.apiEndpoint = String(val('stcig_apiEndpoint', settings.apiEndpoint) ?? '').trim() || '/v1/images/generations';
    settings.size = String(val('stcig_size', settings.size) ?? '').trim();
    settings.quality = val('stcig_quality', settings.quality) ?? '';
    settings.style = val('stcig_style', settings.style) ?? '';
    settings.n = clampInt(num('stcig_n', settings.n), 1, 4, 1);
    settings.responseFormat = normalizeEnum(val('stcig_responseFormat', settings.responseFormat) || 'url', ['url', 'b64_json', 'auto'], 'url');
    settings.extraBodyJson = val('stcig_extraBodyJson', settings.extraBodyJson) ?? '';
    settings.sendNegativeAsField = bool('stcig_sendNegativeAsField', settings.sendNegativeAsField);

    settings.promptMode = normalizeEnum(val('stcig_promptMode', settings.promptMode) || 'main', ['main', 'extractor'], 'main');
    settings.mainInjectionPrompt = val('stcig_mainInjectionPrompt', settings.mainInjectionPrompt) ?? '';
    settings.mainInjectionDepth = clampInt(num('stcig_mainInjectionDepth', settings.mainInjectionDepth), 0, 99, 0);
    settings.mainInjectionPosition = normalizeEnum(
        val('stcig_mainInjectionPosition', settings.mainInjectionPosition) || 'in_prompt',
        ['in_prompt', 'in_chat'],
        'in_prompt',
    );

    settings.extractorUseMainCredentials = bool('stcig_extractorUseMainCredentials', settings.extractorUseMainCredentials);
    settings.extractorBaseUrl = String(val('stcig_extractorBaseUrl', settings.extractorBaseUrl) ?? '').trim();
    settings.extractorApiKey = val('stcig_extractorApiKey', settings.extractorApiKey) ?? '';
    settings.extractorModel = String(val('stcig_extractorModel', settings.extractorModel) ?? '').trim();
    settings.extractorEndpoint = String(val('stcig_extractorEndpoint', settings.extractorEndpoint) ?? '').trim() || '/v1/chat/completions';
    settings.extractorSystemPrompt = val('stcig_extractorSystemPrompt', settings.extractorSystemPrompt) ?? '';
    settings.extractorTemperature = clampNumber(num('stcig_extractorTemperature', settings.extractorTemperature), 0, 2, 0.4);
    settings.extractorMaxTokens = clampInt(num('stcig_extractorMaxTokens', settings.extractorMaxTokens), 32, 4000, 400);

    settings.promptPrefix = val('stcig_promptPrefix', settings.promptPrefix) ?? '';
    settings.promptSuffix = val('stcig_promptSuffix', settings.promptSuffix) ?? '';
    settings.negativePrompt = val('stcig_negativePrompt', settings.negativePrompt) ?? '';

    settings.sfwEnabled = bool('stcig_sfwEnabled', settings.sfwEnabled);
    settings.sfwConstraint = val('stcig_sfwConstraint', settings.sfwConstraint) ?? '';
    settings.sfwSensitiveWords = val('stcig_sfwSensitiveWords', settings.sfwSensitiveWords) ?? '';
    settings.sfwReplaceWith = val('stcig_sfwReplaceWith', settings.sfwReplaceWith) ?? '';

    settings.cooldownMs = clampInt(num('stcig_cooldownMs', settings.cooldownMs), 0, 600000, 3000);
    settings.maxAutoPerChat = clampInt(num('stcig_maxAutoPerChat', settings.maxAutoPerChat), 0, 9999, 0);
    settings.timeoutMs = clampInt(num('stcig_timeoutMs', settings.timeoutMs), 5000, 600000, 120000);
    settings.manualPrompt = val('stcig_manual_prompt', settings.manualPrompt) ?? '';
}

function syncUiFromSettings() {
    const setCheck = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    const setVal = (id, v) => { const el = $(id); if (el) el.value = v ?? ''; };

    setCheck('stcig_enabled', settings.enabled);
    setCheck('stcig_autoGenerate', settings.autoGenerate);
    setCheck('stcig_onlyAiMessages', settings.onlyAiMessages);
    setCheck('stcig_stripTagsFromDisplay', settings.stripTagsFromDisplay);
    setCheck('stcig_insertAsMarkdown', settings.insertAsMarkdown);
    setCheck('stcig_showMessageButtons', settings.showMessageButtons);

    setVal('stcig_apiBaseUrl', settings.apiBaseUrl);
    setVal('stcig_apiKey', settings.apiKey);
    setVal('stcig_apiModel', settings.apiModel);
    setVal('stcig_apiEndpoint', settings.apiEndpoint);
    setVal('stcig_size', settings.size);
    setVal('stcig_quality', settings.quality);
    setVal('stcig_style', settings.style);
    setVal('stcig_n', settings.n);
    setVal('stcig_responseFormat', settings.responseFormat);
    setVal('stcig_extraBodyJson', settings.extraBodyJson);
    setCheck('stcig_sendNegativeAsField', settings.sendNegativeAsField);

    setVal('stcig_promptMode', settings.promptMode);
    setVal('stcig_mainInjectionPrompt', settings.mainInjectionPrompt);
    setVal('stcig_mainInjectionDepth', settings.mainInjectionDepth);
    setVal('stcig_mainInjectionPosition', settings.mainInjectionPosition);

    setCheck('stcig_extractorUseMainCredentials', settings.extractorUseMainCredentials);
    setVal('stcig_extractorBaseUrl', settings.extractorBaseUrl);
    setVal('stcig_extractorApiKey', settings.extractorApiKey);
    setVal('stcig_extractorModel', settings.extractorModel);
    setVal('stcig_extractorEndpoint', settings.extractorEndpoint);
    setVal('stcig_extractorSystemPrompt', settings.extractorSystemPrompt);
    setVal('stcig_extractorTemperature', settings.extractorTemperature);
    setVal('stcig_extractorMaxTokens', settings.extractorMaxTokens);

    setVal('stcig_promptPrefix', settings.promptPrefix);
    setVal('stcig_promptSuffix', settings.promptSuffix);
    setVal('stcig_negativePrompt', settings.negativePrompt);

    setCheck('stcig_sfwEnabled', settings.sfwEnabled);
    setVal('stcig_sfwConstraint', settings.sfwConstraint);
    setVal('stcig_sfwSensitiveWords', settings.sfwSensitiveWords);
    setVal('stcig_sfwReplaceWith', settings.sfwReplaceWith);

    setVal('stcig_cooldownMs', settings.cooldownMs);
    setVal('stcig_maxAutoPerChat', settings.maxAutoPerChat);
    setVal('stcig_timeoutMs', settings.timeoutMs);
    setVal('stcig_manual_prompt', settings.manualPrompt);

    // Keep select options in sync with current values / last fetched list.
    populateModelSelectors(cachedModelList, { selectCurrent: true });

    updateStatusBadges();
    updateModeVisibility();
    refreshLogPanel();
}

function updateStatusBadges() {
    const badge = $('stcig_status_badge');
    if (badge) {
        badge.textContent = settings.enabled ? '已启用' : '已关闭';
        badge.classList.toggle('on', !!settings.enabled);
        badge.classList.toggle('off', !settings.enabled);
    }
    const mode = $('stcig_mode_badge');
    if (mode) mode.textContent = `模式: ${settings.promptMode || 'main'}`;
    const sfw = $('stcig_sfw_badge');
    if (sfw) sfw.textContent = `SFW: ${settings.sfwEnabled ? '开' : '关'}`;
}

function updateModeVisibility() {
    const isExtractor = settings.promptMode === 'extractor';
    const extractorIds = [
        'stcig_extractorUseMainCredentials', 'stcig_extractorBaseUrl', 'stcig_extractorApiKey',
        'stcig_extractorModel', 'stcig_extractorModel_select', 'stcig_extractorEndpoint', 'stcig_extractorSystemPrompt',
        'stcig_extractorTemperature', 'stcig_extractorMaxTokens',
    ];
    for (const id of extractorIds) {
        const el = $(id);
        if (!el) continue;
        const field = el.closest('.stcig-field, .stcig-row, label') || el;
        field.style.opacity = isExtractor ? '1' : '0.45';
        field.style.pointerEvents = isExtractor ? '' : 'none';
        if ('disabled' in el) el.disabled = !isExtractor;
    }
    const mainOnlyIds = ['stcig_mainInjectionPrompt', 'stcig_mainInjectionDepth', 'stcig_mainInjectionPosition'];
    for (const id of mainOnlyIds) {
        const el = $(id);
        if (!el) continue;
        const field = el.closest('.stcig-field, .stcig-row, label') || el;
        field.style.opacity = isExtractor ? '0.55' : '1';
    }
}

function refreshLogPanel() {
    const el = $('stcig_log');
    if (!el) return;
    el.textContent = logLines.length ? logLines.join('\n') : '（暂无日志）';
    el.scrollTop = el.scrollHeight;
}

function buildInjectionText() {
    if (!settings.enabled || settings.promptMode !== 'main') return '';
    let text = settings.mainInjectionPrompt || DEFAULT_MAIN_INJECTION;
    // allow light placeholders from prompts.js style templates
    const ctx = getContextSafe();
    text = fillTemplate(text, {
        char: ctx.name2 || 'Character',
        user: ctx.name1 || 'User',
        prefix: settings.promptPrefix || '',
        suffix: settings.promptSuffix || '',
        negative: getEffectiveNegativePrompt(),
        sfw_constraint: settings.sfwEnabled ? (settings.sfwConstraint || DEFAULT_SFW_CONSTRAINT) : '',
    });
    if (settings.sfwEnabled) {
        const c = (settings.sfwConstraint || DEFAULT_SFW_CONSTRAINT).trim();
        if (c && !text.includes(c)) {
            text += `\n\nSFW REQUIREMENT:\n${c}\nThe content inside <image_prompt> or \`\`\`stcig-prompt must obey SFW rules.`;
        }
    }
    return text;
}

function applyExtensionPromptInjection() {
    const text = buildInjectionText();
    try {
        if (typeof setExtensionPrompt === 'function') {
            const posKey = settings.mainInjectionPosition === 'in_chat' ? 'IN_CHAT' : 'IN_PROMPT';
            const position = (extension_prompt_types && extension_prompt_types[posKey] !== undefined)
                ? extension_prompt_types[posKey]
                : (posKey === 'IN_CHAT' ? 1 : 0);
            const role = (extension_prompt_roles && extension_prompt_roles.SYSTEM !== undefined)
                ? extension_prompt_roles.SYSTEM
                : 0;
            setExtensionPrompt(MODULE_NAME, text, position, settings.mainInjectionDepth || 0, false, role);
            if (lastInjectedPromptText !== text) {
                lastInjectedPromptText = text;
                log('info', text ? '已更新主模式注入提示' : '已清空注入提示');
            }
            return;
        }
    } catch (err) {
        log('warn', 'setExtensionPrompt 调用失败，尝试 fallback', err?.message || err);
    }

    try {
        window.stcig_extensionPrompt = text;
        if (window.extension_prompts && typeof window.extension_prompts === 'object') {
            window.extension_prompts[MODULE_NAME] = {
                value: text,
                position: settings.mainInjectionPosition === 'in_chat' ? 1 : 0,
                depth: settings.mainInjectionDepth || 0,
                role: 0,
                scan: false,
            };
        }
    } catch (_) { /* ignore */ }
}


function getPromptsModule() {
    try {
        return window.STCustomImageGenPrompts || null;
    } catch (_) {
        return null;
    }
}

function fillTemplate(template, vars = {}) {
    let out = String(template ?? '');
    for (const [key, value] of Object.entries(vars)) {
        const re = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, 'g');
        out = out.replace(re, value == null ? '' : String(value));
    }
    // drop unresolved optional placeholders
    out = out.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, '');
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

function buildHistorySnippet(limit = 6) {
    const ctx = getContextSafe();
    const chat = ctx.chat || [];
    const parts = [];
    for (let i = Math.max(0, chat.length - limit); i < chat.length; i++) {
        const m = chat[i];
        if (!m) continue;
        const role = m.is_user ? (ctx.name1 || 'User') : (m.name || ctx.name2 || 'Character');
        const body = String(m.mes || '').replace(/\s+/g, ' ').trim().slice(0, 280);
        if (!body) continue;
        parts.push(`${role}: ${body}`);
    }
    return parts.join('\n');
}

function getEffectiveNegativePrompt() {
    let negative = String(settings.negativePrompt || '').trim();
    if (settings.sfwEnabled) {
        const p = getPromptsModule();
        const extra = String(p?.SFW_EXTRA_NEGATIVE || 'nsfw, nude, naked, explicit, sexual, porn').trim();
        if (extra) {
            const existing = new Set(
                negative.split(/[,，\n]/).map(s => s.trim().toLowerCase()).filter(Boolean),
            );
            const add = extra
                .split(/[,，\n]/)
                .map(s => s.trim())
                .filter(Boolean)
                .filter(s => !existing.has(s.toLowerCase()));
            if (add.length) {
                negative = negative ? `${negative}, ${add.join(', ')}` : add.join(', ');
            }
        }
    }
    return negative.trim();
}

function applyPromptDefaults({ forceTemplates = false, forcePrefix = false } = {}) {
    const p = getPromptsModule();
    let changed = false;

    if (forcePrefix || !String(settings.promptPrefix || '').trim()) {
        const v = p?.DEFAULT_PROMPT_PREFIX || 'masterpiece, best quality, highly detailed, sharp focus';
        if (settings.promptPrefix !== v) { settings.promptPrefix = v; changed = true; }
    }
    if (forcePrefix || !String(settings.promptSuffix || '').trim()) {
        const v = p?.DEFAULT_PROMPT_SUFFIX || 'cinematic lighting, beautiful composition, depth of field';
        if (settings.promptSuffix !== v) { settings.promptSuffix = v; changed = true; }
    }
    if (forcePrefix || !String(settings.negativePrompt || '').trim()) {
        const v = p?.DEFAULT_NEGATIVE_PROMPT || DEFAULT_SETTINGS.negativePrompt || '';
        if (v && settings.negativePrompt !== v) { settings.negativePrompt = v; changed = true; }
    }

    if (forceTemplates || !String(settings.extractorSystemPrompt || '').trim()
        || settings.extractorSystemPrompt === DEFAULT_EXTRACTOR_SYSTEM) {
        const v = p?.EXTRACTOR_SYSTEM_PROMPT || DEFAULT_EXTRACTOR_SYSTEM;
        // keep placeholders for runtime fill; strip only pure empty
        if (v && settings.extractorSystemPrompt !== v) {
            // Prefer module template only when force or still on built-in default
            if (forceTemplates || settings.extractorSystemPrompt === DEFAULT_EXTRACTOR_SYSTEM || !settings.extractorSystemPrompt) {
                settings.extractorSystemPrompt = v;
                changed = true;
            }
        }
    }

    if (forceTemplates || !String(settings.sfwConstraint || '').trim()
        || settings.sfwConstraint === DEFAULT_SFW_CONSTRAINT) {
        const v = p?.SFW_CONSTRAINT || DEFAULT_SFW_CONSTRAINT;
        if (v && settings.sfwConstraint !== v) {
            settings.sfwConstraint = v;
            changed = true;
        }
    }

    // Main inject stays XML-friendly by default; only overwrite when forced
    if (forceTemplates) {
        // Prefer local DEFAULT_MAIN_INJECTION which matches <image_prompt> parser,
        // but append fence alternative already included.
        settings.mainInjectionPrompt = DEFAULT_MAIN_INJECTION;
        changed = true;
    }

    if (changed) saveSettings();
    return changed;
}

function extractTaggedPrompt(text) {
    if (!text) return '';
    const src = String(text);
    const m = src.match(IMAGE_PROMPT_RE);
    if (m) return m[1].trim();
    // also accept ```stcig-prompt fences from prompts.js
    const fence = src.match(/```stcig-prompt\s*([\s\S]*?)```/i);
    return fence ? fence[1].trim() : '';
}

/** True when the text contains an <image_prompt> tag or a ```stcig-prompt fence. */
function containsImagePromptBlock(text) {
    const s = String(text || '');
    return /<image_prompt>[\s\S]*?<\/image_prompt>/i.test(s) || /```stcig-prompt/i.test(s);
}

function stripImagePromptTags(text) {
    if (!text) return text;
    // Fresh regex instances avoid lastIndex pollution from the shared /g patterns.
    return String(text)
        .replace(/<image_prompt>\s*[\s\S]*?\s*<\/image_prompt>/gi, '')
        .replace(/```stcig-prompt\s*[\s\S]*?```/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeSensitiveWords(text) {
    if (!settings.sfwEnabled) return text;
    const raw = settings.sfwSensitiveWords || '';
    const words = raw.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
    if (!words.length) return text;
    const replaceWith = settings.sfwReplaceWith ?? '[sfw]';
    let out = String(text);
    for (const w of words) {
        try {
            const re = new RegExp(escapeRegExp(w), 'gi');
            out = out.replace(re, replaceWith);
        } catch (_) {
            out = out.split(w).join(replaceWith);
        }
    }
    return out;
}

function shapeFinalPrompt(rawPrompt) {
    let prompt = String(rawPrompt || '').trim();
    if (!prompt) return '';

    if (settings.sfwEnabled) {
        prompt = sanitizeSensitiveWords(prompt);
        const c = (settings.sfwConstraint || '').trim();
        // Keep constraint short in the actual image prompt; long policy text stays in injection/extractor.
        if (c) {
            const shortSfw = c.length > 180 ? 'SFW, safe for work, modest clothing, no nudity, no sexual content' : c;
            if (!/\bsfw\b/i.test(prompt)) {
                prompt = `${prompt}, ${shortSfw}`;
            }
        } else if (!/\bsfw\b/i.test(prompt)) {
            prompt = `${prompt}, SFW, safe for work`;
        }
    }

    const prefix = (settings.promptPrefix || '').trim();
    const suffix = (settings.promptSuffix || '').trim();
    if (prefix) prompt = `${prefix} ${prompt}`.trim();
    if (suffix) prompt = `${prompt} ${suffix}`.trim();

    const negative = getEffectiveNegativePrompt();
    if (negative && !settings.sendNegativeAsField) {
        prompt = `${prompt}. Avoid: ${negative}`.trim();
    }

    return prompt.replace(/\s+/g, ' ').trim();
}

async function extractPromptFromMessage(messageText, { forceExtractor = false, allowExtractorFallback = false } = {}) {
    const tagged = extractTaggedPrompt(messageText);
    if (tagged && !forceExtractor) {
        // Prefer explicit tags in both modes to avoid unnecessary extractor calls.
        return tagged;
    }
    if (settings.promptMode === 'main' && !forceExtractor && !allowExtractorFallback) {
        return '';
    }
    // extractor mode, forced extractor, or manual fallback path
    return await callExtractorApi(messageText);
}

function stripTrailingSlashes(value) {
    return String(value || '').replace(/\/+$/, '');
}

function ensureLeadingSlash(value) {
    const s = String(value || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    return s.startsWith('/') ? s : `/${s}`;
}

/**
 * Smart OpenAI-compat URL join.
 * Avoids /v1/v1/... when base already ends with /v1 and endpoint also starts with /v1/.
 * Absolute endpoint URLs are returned as-is.
 */
function joinUrl(base, path) {
    const rawBase = String(base || '').trim();
    const rawPath = String(path || '').trim();
    if (!rawBase && !rawPath) return '';
    if (/^https?:\/\//i.test(rawPath)) return rawPath;

    const b = stripTrailingSlashes(rawBase);
    let p = ensureLeadingSlash(rawPath);
    if (!b) return p || '';
    if (!p) return b;

    // Collapse duplicated /v1 prefixes: base ends with /v1 and path starts with /v1/
    const baseHasV1 = /\/v1$/i.test(b);
    if (baseHasV1 && /^\/v1(\/|$)/i.test(p)) {
        p = p.replace(/^\/v1/i, '') || '/';
        if (!p.startsWith('/')) p = `/${p}`;
    }

    // Also collapse exact duplicated trailing segment pairs like /openai + /openai/...
    try {
        const baseUrl = new URL(b.includes('://') ? b : `http://dummy.local${b.startsWith('/') ? b : `/${b}`}`);
        const basePath = stripTrailingSlashes(baseUrl.pathname || '');
        if (basePath && basePath !== '/' && p.toLowerCase().startsWith(basePath.toLowerCase() + '/')) {
            // path already contains base path prefix
            p = p.slice(basePath.length) || '/';
            if (!p.startsWith('/')) p = `/${p}`;
        } else if (basePath && basePath !== '/' && p.toLowerCase() === basePath.toLowerCase()) {
            p = '';
        }
    } catch (_) {
        // ignore URL parse failures for exotic bases
    }

    return p ? `${b}${p}` : b;
}

function buildApiUrl(baseUrl, endpoint) {
    return joinUrl(baseUrl, endpoint);
}

function candidateModelsUrls(baseUrl) {
    const base = stripTrailingSlashes(String(baseUrl || '').trim());
    if (!base) return [];
    const urls = [];
    const push = (u) => {
        const s = String(u || '').trim();
        if (s && !urls.includes(s)) urls.push(s);
    };

    // Prefer natural OpenAI-compat locations relative to configured base.
    push(joinUrl(base, '/models'));
    push(joinUrl(base, '/v1/models'));
    push(joinUrl(base, '/openai/v1/models'));

    // If base already ends with /v1, also try parent host /v1/models and /models.
    if (/\/v1$/i.test(base)) {
        const parent = base.replace(/\/v1$/i, '');
        push(joinUrl(parent, '/v1/models'));
        push(joinUrl(parent, '/models'));
    } else {
        // base without /v1: try host root variants
        try {
            const u = new URL(base);
            push(`${stripTrailingSlashes(u.origin)}/v1/models`);
            push(`${stripTrailingSlashes(u.origin)}/models`);
        } catch (_) {
            /* ignore */
        }
    }
    return urls;
}

function parseModelIds(data) {
    const ids = [];
    const push = (id) => {
        const s = String(id || '').trim();
        if (s && !ids.includes(s)) ids.push(s);
    };
    if (!data) return ids;
    if (Array.isArray(data)) {
        for (const item of data) {
            if (typeof item === 'string') push(item);
            else if (item && typeof item === 'object') push(item.id || item.model || item.name);
        }
        return ids;
    }
    const bags = [];
    if (Array.isArray(data.data)) bags.push(data.data);
    if (Array.isArray(data.models)) bags.push(data.models);
    if (Array.isArray(data.data?.data)) bags.push(data.data.data);
    if (Array.isArray(data.result)) bags.push(data.result);
    if (Array.isArray(data.results)) bags.push(data.results);
    for (const bag of bags) {
        for (const item of bag) {
            if (typeof item === 'string') push(item);
            else if (item && typeof item === 'object') push(item.id || item.model || item.name);
        }
    }
    // Gemini-ish / gateway shapes
    if (typeof data.model === 'string') push(data.model);
    if (typeof data.id === 'string') push(data.id);
    return ids;
}

function authHeaders(apiKey, extra = {}) {
    const headers = { ...extra };
    const key = String(apiKey || '').trim();
    if (key) {
        headers.Authorization = `Bearer ${key}`;
        // Some OpenAI-compatible / Gemini gateways also accept these.
        if (!headers['x-api-key']) headers['x-api-key'] = key;
    }
    return headers;
}

/** Last fetched model ids kept for re-sync after manual edits. */
let cachedModelList = [];

/**
 * Fill a real <select> with model options. Mobile WebView supports this reliably.
 * Always keeps a blank first option so users can keep typing custom model names.
 */
function fillModelSelect(selectId, models, currentValue) {
    const sel = document.getElementById(selectId);
    if (!sel) return 0;
    const ids = [];
    const seen = new Set();
    const pushId = (raw) => {
        const id = String(raw || '').trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    };
    if (Array.isArray(models)) {
        for (const m of models) pushId(m);
    }
    const cur = String(currentValue || '').trim();
    // Keep current custom value visible in the select list when it is not from API.
    if (cur && !seen.has(cur)) ids.unshift(cur);

    const prev = String(sel.value || '');
    sel.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = ids.length ? '（手输 / 从列表选择）' : '（获取列表后可下拉选择）';
    sel.appendChild(blank);
    for (const id of ids) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        sel.appendChild(opt);
    }
    if ((cur && seen.has(cur)) || (cur && ids.includes(cur))) {
        sel.value = cur;
    } else if (prev && ids.includes(prev)) {
        sel.value = prev;
    } else {
        sel.value = '';
    }
    return ids.length;
}

function syncModelSelectToValue(selectId, value) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const cur = String(value || '').trim();
    if (!cur) {
        sel.value = '';
        return;
    }
    const has = Array.from(sel.options).some((o) => o.value === cur);
    if (!has) {
        const opt = document.createElement('option');
        opt.value = cur;
        opt.textContent = cur;
        // Insert after blank option when possible.
        if (sel.options.length > 1) sel.insertBefore(opt, sel.options[1]);
        else sel.appendChild(opt);
    }
    sel.value = cur;
}

function bindModelPickerUi(fieldKey, settingsKey) {
    const input = $(`stcig_${fieldKey}`);
    const select = $(`stcig_${fieldKey}_select`);
    if (select && !select.dataset.stcigModelBound) {
        select.dataset.stcigModelBound = '1';
        select.addEventListener('change', () => {
            const v = String(select.value || '').trim();
            if (!v) return;
            if (input) input.value = v;
            settings[settingsKey] = v;
            saveSettings();
            applyExtensionPromptInjection();
            updateStatusBadges();
            log('info', `已选择${settingsKey === 'apiModel' ? '生图' : '提取器'}模型`, v);
        });
    }
    if (input && !input.dataset.stcigModelBound) {
        input.dataset.stcigModelBound = '1';
        const persist = () => {
            const v = String(input.value || '').trim();
            settings[settingsKey] = v;
            syncModelSelectToValue(`stcig_${fieldKey}_select`, v);
            saveSettings();
            applyExtensionPromptInjection();
            updateStatusBadges();
        };
        input.addEventListener('change', persist);
        input.addEventListener('blur', persist);
    }
}

function populateModelSelectors(models, { selectCurrent = true } = {}) {
    const ids = Array.isArray(models) ? models.filter(Boolean).map((x) => String(x).trim()).filter(Boolean) : [];
    // Deduplicate while preserving order.
    const uniq = [];
    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        uniq.push(id);
    }
    if (uniq.length) cachedModelList = uniq.slice();

    const source = uniq.length ? uniq : cachedModelList;
    const n1 = fillModelSelect('stcig_apiModel_select', source, settings.apiModel);
    const n2 = fillModelSelect('stcig_extractorModel_select', source, settings.extractorModel);
    const hint = $('stcig_model_fetch_hint');
    if (hint) {
        hint.textContent = source.length
            ? `已加载 ${source.length} 个模型：上方下拉选择，或下方手输任意名称`
            : '未获取到模型列表，可手动填写模型名';
    }
    if (selectCurrent) {
        const modelInput = $('stcig_apiModel');
        if (modelInput) modelInput.value = settings.apiModel || '';
        const extInput = $('stcig_extractorModel');
        if (extInput) extInput.value = settings.extractorModel || '';
        syncModelSelectToValue('stcig_apiModel_select', settings.apiModel);
        syncModelSelectToValue('stcig_extractorModel_select', settings.extractorModel);
    }
    return Math.max(n1, n2, source.length);
}

/** Prefill the main image model from a freshly fetched list when it is still empty. */
function prefillApiModelIfEmpty(models) {
    if (settings.apiModel || !Array.isArray(models) || !models.length) return;
    settings.apiModel = models[0];
    const el = $('stcig_apiModel');
    if (el) el.value = models[0];
    syncModelSelectToValue('stcig_apiModel_select', models[0]);
    saveSettings();
}

/** Cap the /models probe timeout so a slow gateway does not hold the UI for minutes. */
function modelsFetchTimeoutMs() {
    return Math.min(settings.timeoutMs || 120000, 30000);
}

async function fetchModelsOnly() {
    readUiIntoSettings();
    saveSettings();
    const base = String(settings.apiBaseUrl || '').trim();
    const key = String(settings.apiKey || '').trim();
    if (!base) {
        toast('warning', '请先填写生图 Base URL');
        return;
    }
    try {
        toast('info', '正在获取模型列表...');
        const result = await fetchModelList(base, key, { timeoutMs: modelsFetchTimeoutMs() });
        const models = result.models || [];
        populateModelSelectors(models, { selectCurrent: true });
        prefillApiModelIfEmpty(models);
        toast('success', `已加载 ${models.length} 个模型`);
        log('info', `模型列表获取成功（${models.length}）`, { url: result.url, sample: models.slice(0, 12) });
    } catch (err) {
        populateModelSelectors(cachedModelList, { selectCurrent: true });
        const msg = err?.message || String(err);
        toast('error', `获取模型列表失败: ${msg}`);
        log('error', '获取模型列表失败', msg);
    }
}

async function fetchModelList(baseUrl, apiKey, { timeoutMs = 20000 } = {}) {
    const base = String(baseUrl || '').trim();
    if (!base) throw new Error('Base URL 未配置');
    const candidates = candidateModelsUrls(base);
    if (!candidates.length) throw new Error('无法构造 /models 请求地址');

    const errors = [];
    for (const url of candidates) {
        try {
            log('info', '拉取模型列表', { url });
            const data = await fetchJson(url, {
                method: 'GET',
                headers: authHeaders(apiKey, { Accept: 'application/json' }),
                timeoutMs,
            });
            const models = parseModelIds(data);
            if (models.length) {
                return { models, url, raw: data };
            }
            errors.push(`${url} -> 响应无模型字段`);
        } catch (err) {
            errors.push(`${url} -> ${err?.message || err}`);
        }
    }
    const err = new Error(errors.slice(0, 4).join(' | ') || '拉取模型列表失败');
    err.code = 'MODELS_FETCH_FAILED';
    err.details = errors;
    throw err;
}

function extractApiErrorMessage(data, statusText, status) {
    const candidates = [
        data?.error?.message,
        data?.error?.msg,
        typeof data?.error === 'string' ? data.error : null,
        data?.message,
        data?.msg,
        data?.detail,
        Array.isArray(data?.errors) ? data.errors.map(e => e?.message || e).filter(Boolean).join('; ') : null,
        data?.raw,
        statusText,
    ];
    for (const c of candidates) {
        if (c == null) continue;
        const s = String(c).trim();
        if (s) return s.slice(0, 500);
    }
    return `HTTP ${status || '?'}`;
}

/**
 * Interpret a non-JSON response body. Some gateways return bare base64,
 * data URIs or plain image URLs as text/plain.
 */
function parseLooseResponseText(text, { allowUrlSafeB64 = false } = {}) {
    try {
        return text ? JSON.parse(text) : null;
    } catch (_) {
        const plain = String(text || '').trim();
        const b64Re = allowUrlSafeB64 ? /^[A-Za-z0-9+/=\s_-]+$/ : /^[A-Za-z0-9+/=\s]+$/;
        if (plain && (
            plain.startsWith('data:image/')
            || /^https?:\/\//i.test(plain)
            || (b64Re.test(plain) && plain.replace(/\s+/g, '').length > 64)
        )) {
            return plain;
        }
        return { raw: text };
    }
}

function throwHttpError(res, data, method, url) {
    const msg = extractApiErrorMessage(data, res.statusText, res.status);
    const err = new Error(`${msg} (${method} ${url})`);
    err.status = res.status;
    err.data = data;
    err.url = url;
    throw err;
}

async function fetchJson(url, { method = 'POST', headers = {}, body, timeoutMs, acceptBinaryImage = false } = {}) {
    const controller = new AbortController();
    const ms = timeoutMs ?? settings.timeoutMs ?? 120000;
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });

        const contentType = String(res.headers.get('content-type') || '').toLowerCase();

        // When image bytes are possible, read as ArrayBuffer first.
        // Some gateways return PNG/JPEG with wrong/missing content-type.
        if (acceptBinaryImage) {
            const buf = await res.arrayBuffer();
            const bytes = new Uint8Array(buf || []);
            const mimeFromHeader = contentType.startsWith('image/')
                ? (contentType.split(';')[0].trim() || 'image/png')
                : null;
            const mimeFromBytes = guessImageMimeFromBytes(bytes);
            const looksBinaryImage = !!(mimeFromHeader || mimeFromBytes);
            const declaredBinary = (
                contentType.startsWith('image/')
                || contentType.includes('application/octet-stream')
                || contentType.includes('binary')
            );

            if (res.ok && looksBinaryImage && (declaredBinary || mimeFromBytes)) {
                if (!bytes.length) {
                    throw new Error(`图片响应为空（${contentType || 'unknown'}）：${url}`);
                }
                const mime = mimeFromHeader || mimeFromBytes || 'image/png';
                const b64 = arrayBufferToBase64(buf);
                const dataUri = `data:${mime};base64,${b64}`;
                return {
                    __stcigRawImage: true,
                    contentType: mime,
                    b64_json: b64,
                    url: dataUri,
                    dataUri,
                    rawBytes: bytes.length,
                };
            }

            const text = new TextDecoder('utf-8').decode(bytes);
            const data = parseLooseResponseText(text, { allowUrlSafeB64: true });
            if (!res.ok) throwHttpError(res, data, method, url);
            return data;
        }

        const text = await res.text();
        const data = parseLooseResponseText(text, { allowUrlSafeB64: false });
        if (!res.ok) throwHttpError(res, data, method, url);
        return data;
    } catch (err) {
        if (err?.name === 'AbortError' || controller.signal.aborted) {
            const timeoutErr = new Error(`请求超时（${ms}ms）：${url}`);
            timeoutErr.code = 'TIMEOUT';
            timeoutErr.cause = err;
            throw timeoutErr;
        }
        if (err instanceof TypeError) {
            const netErr = new Error(`网络请求失败：${err.message || 'fetch failed'}（${url}）`);
            netErr.code = 'NETWORK';
            netErr.cause = err;
            throw netErr;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function arrayBufferToBase64(buf) {
    if (!buf) return '';
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(buf).toString('base64');
    }
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    if (typeof btoa === 'function') return btoa(binary);
    throw new Error('无法将图片字节编码为 base64');
}

function guessImageMimeFromBytes(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
        && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
    return null;
}

function normalizeMimeType(mime, fallback = 'image/png') {
    const m = String(mime || '').trim().toLowerCase();
    if (!m) return fallback;
    if (m === 'jpg') return 'image/jpeg';
    if (m.startsWith('image/')) return m.split(';')[0].trim();
    if (/^(png|jpeg|jpg|gif|webp|bmp|svg\+xml)$/i.test(m)) {
        return `image/${m === 'jpg' ? 'jpeg' : m}`;
    }
    return fallback;
}

function makeImageRefFromUrl(url) {
    const u = String(url || '').trim();
    if (!u) return null;
    if (u.startsWith('data:')) return { url: u, b64: null, dataUri: u };
    if (/^https?:\/\//i.test(u) || u.startsWith('//') || u.startsWith('blob:')) {
        const normalized = u.startsWith('//') ? `https:${u}` : u;
        return { url: normalized, b64: null, dataUri: null };
    }
    return null;
}

function makeImageRefFromBase64(b64, mime) {
    let raw = String(b64 || '').trim();
    if (!raw) return null;
    if (raw.startsWith('data:')) return { url: raw, b64: null, dataUri: raw };
    // Strip optional data-uri prefix leftovers and whitespace.
    raw = raw.replace(/^data:[^,]+,/i, '').replace(/\s+/g, '');
    if (!raw || raw.length < 16) return null;
    // Reject obvious non-base64 short tokens.
    if (!/^[A-Za-z0-9+/=_-]+$/.test(raw)) return null;
    // URL-safe base64 -> standard
    if (raw.includes('-') || raw.includes('_')) {
        raw = raw.replace(/-/g, '+').replace(/_/g, '/');
    }
    const m = normalizeMimeType(mime, 'image/png');
    const dataUri = `data:${m};base64,${raw}`;
    return { url: dataUri, b64: raw, dataUri };
}

function lookLikeBase64Image(s) {
    const raw = String(s || '').replace(/\s+/g, '');
    if (raw.length < 64) return false;
    if (!/^[A-Za-z0-9+/=_-]+$/.test(raw)) return false;
    // Heuristic: decoded image headers often start with iVBOR (PNG) / /9j/ (JPEG) / R0lGOD (GIF) / UklGR (WEBP)
    if (/^(iVBOR|\/9j\/|R0lGOD|UklGR|Qk[0-9A-Za-z]|PHN2Zy)/.test(raw)) return true;
    // Fallback for unrecognized headers: require enough length to plausibly be image bytes,
    // and reject pure-hex strings (API tokens / hashes) that would otherwise false-positive.
    if (raw.length <= 1024) return false;
    if (/^[0-9a-fA-F]+$/.test(raw)) return false;
    return true;
}

function pickFirstString(...vals) {
    for (const v of vals) {
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (v && typeof v === 'object') {
            if (typeof v.url === 'string' && v.url.trim()) return v.url.trim();
            if (typeof v.href === 'string' && v.href.trim()) return v.href.trim();
        }
    }
    return null;
}

function summarizeResponseShape(data, depth = 0, maxDepth = 3, maxKeys = 10) {
    try {
        if (data == null) return String(data);
        if (typeof data === 'string') {
            const s = data.trim();
            if (s.startsWith('data:image/')) return `string(data-uri,len=${s.length})`;
            if (/^https?:\/\//i.test(s)) return `string(url,len=${Math.min(s.length, 120)})`;
            if (lookLikeBase64Image(s)) return `string(base64?,len=${s.replace(/\s+/g, '').length})`;
            return `string(len=${s.length},preview=${JSON.stringify(s.slice(0, 48))})`;
        }
        if (typeof data === 'number' || typeof data === 'boolean') return String(data);
        if (Array.isArray(data)) {
            if (depth >= maxDepth) return `array(len=${data.length})`;
            const head = data.slice(0, 3).map(x => summarizeResponseShape(x, depth + 1, maxDepth, maxKeys));
            const more = data.length > 3 ? `,…+${data.length - 3}` : '';
            return `[${head.join(', ')}${more}]`;
        }
        if (typeof data === 'object') {
            if (data.__stcigRawImage) {
                return `raw-image(mime=${data.contentType || '?'},bytes=${data.rawBytes || '?'})`;
            }
            const keys = Object.keys(data);
            if (depth >= maxDepth) return `{${keys.slice(0, maxKeys).join(',')}${keys.length > maxKeys ? ',…' : ''}}`;
            const parts = [];
            for (const k of keys.slice(0, maxKeys)) {
                const v = data[k];
                if (v == null) {
                    parts.push(`${k}:null`);
                    continue;
                }
                if (typeof v === 'string') {
                    const s = v.trim();
                    if (s.startsWith('data:image/')) parts.push(`${k}:data-uri(len=${s.length})`);
                    else if (/^https?:\/\//i.test(s)) parts.push(`${k}:url`);
                    else if (lookLikeBase64Image(s)) parts.push(`${k}:base64?(len=${s.replace(/\s+/g, '').length})`);
                    else parts.push(`${k}:string(len=${s.length})`);
                } else if (Array.isArray(v)) {
                    parts.push(`${k}:array(len=${v.length})`);
                } else if (typeof v === 'object') {
                    parts.push(`${k}:${summarizeResponseShape(v, depth + 1, maxDepth, Math.min(6, maxKeys))}`);
                } else {
                    parts.push(`${k}:${typeof v}`);
                }
            }
            if (keys.length > maxKeys) parts.push('…');
            return `{${parts.join(', ')}}`;
        }
        return typeof data;
    } catch (_) {
        return typeof data;
    }
}

async function callExtractorApi(messageText) {
    const useMain = settings.extractorUseMainCredentials;
    const base = (useMain ? settings.apiBaseUrl : (settings.extractorBaseUrl || settings.apiBaseUrl)) || '';
    const key = useMain ? settings.apiKey : (settings.extractorApiKey || settings.apiKey);
    const model = settings.extractorModel || 'gpt-4o-mini';
    const endpoint = settings.extractorEndpoint || '/v1/chat/completions';
    if (!base) throw new Error('提取器 Base URL 未配置');
    if (!key) throw new Error('提取器 API Key 未配置');

    const p = getPromptsModule();
    const ctx = getContextSafe();
    const vars = {
        char: ctx.name2 || 'Character',
        user: ctx.name1 || 'User',
        message: String(messageText || '').slice(0, 12000),
        history: buildHistorySnippet(6),
        scene: '',
        style: settings.promptPrefix || '',
        prefix: settings.promptPrefix || '',
        suffix: settings.promptSuffix || '',
        negative: getEffectiveNegativePrompt(),
        sfw_constraint: settings.sfwEnabled
            ? (settings.sfwConstraint || p?.SFW_CONSTRAINT || DEFAULT_SFW_CONSTRAINT)
            : '',
    };

    let system = settings.extractorSystemPrompt || p?.EXTRACTOR_SYSTEM_PROMPT || DEFAULT_EXTRACTOR_SYSTEM;
    system = fillTemplate(system, vars);
    if (settings.sfwEnabled) {
        const c = String(vars.sfw_constraint || '').trim();
        if (c && !system.includes(c)) system = `${system}\n\nSFW:\n${c}`;
    }

    const userTemplate = p?.EXTRACTOR_USER_TEMPLATE
        || [
            '角色：{{char}}',
            '用户：{{user}}',
            '',
            '近期上下文：',
            '{{history}}',
            '',
            '待提取的最新消息：',
            '{{message}}',
            '',
            '请输出一张图的英文生图提示词：',
        ].join('\n');
    const userContent = fillTemplate(userTemplate, vars) || String(messageText || '').slice(0, 12000);

    const url = buildApiUrl(base, endpoint);
    log('info', '调用提取器', { url, model, base, endpoint });

    const data = await fetchJson(url, {
        headers: authHeaders(key, { 'Content-Type': 'application/json' }),
        body: {
            model,
            temperature: settings.extractorTemperature,
            max_tokens: settings.extractorMaxTokens,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: userContent },
            ],
        },
    });

    const content = data?.choices?.[0]?.message?.content
        ?? data?.choices?.[0]?.text
        ?? data?.output_text
        ?? '';
    const prompt = String(content || '').trim().replace(/^["'`]+|["'`]+$/g, '');
    if (!prompt) throw new Error('提取器未返回有效提示词');
    return extractTaggedPrompt(prompt) || prompt;
}

function buildImageRequestBody(finalPrompt) {
    const body = {
        model: settings.apiModel || undefined,
        prompt: finalPrompt,
        n: clampInt(settings.n, 1, 4, 1),
    };

    if (settings.size) body.size = settings.size;
    if (settings.quality) body.quality = settings.quality;
    if (settings.style) body.style = settings.style;
    if (settings.responseFormat && settings.responseFormat !== 'auto') {
        body.response_format = settings.responseFormat;
    }

    const negative = getEffectiveNegativePrompt();
    if (negative && settings.sendNegativeAsField) {
        body.negative_prompt = negative;
        body.negativePrompt = negative;
    }

    const extraRaw = (settings.extraBodyJson || '').trim();
    if (extraRaw) {
        try {
            const extra = JSON.parse(extraRaw);
            if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
                Object.assign(body, extra);
            }
        } catch (err) {
            log('warn', '额外 JSON Body 解析失败，已忽略', err?.message || err);
        }
    }

    for (const k of Object.keys(body)) {
        if (body[k] === undefined || body[k] === '') delete body[k];
    }
    return body;
}

function coerceImageRef(value, seen) {
    if (value == null) return null;

    if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return null;
        const asUrl = makeImageRefFromUrl(s);
        if (asUrl) return asUrl;
        if (lookLikeBase64Image(s) || (/^[A-Za-z0-9+/=\s_-]+$/.test(s) && s.replace(/\s+/g, '').length > 64)) {
            return makeImageRefFromBase64(s);
        }
        // Markdown image or bare URL inside free text
        const md = s.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[a-zA-Z+.-]+;base64,[^)\s]+)\)/);
        if (md) return makeImageRefFromUrl(md[1]) || makeImageRefFromBase64(md[1]);
        const bare = s.match(/(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^\s"'<>]*)?)/i);
        if (bare) return makeImageRefFromUrl(bare[1]);
        const dataInText = s.match(/(data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=\s]+)/);
        if (dataInText) return makeImageRefFromUrl(dataInText[1].replace(/\s+/g, ''));
        return null;
    }

    if (typeof value !== 'object') return null;
    if (seen) {
        if (seen.has(value)) return null;
        seen.add(value);
    }

    // Already-normalized / raw-image package from fetchJson
    if (value.__stcigRawImage && (value.dataUri || value.url || value.b64_json)) {
        if (value.dataUri) return { url: value.dataUri, b64: value.b64_json || null, dataUri: value.dataUri };
        if (value.b64_json) return makeImageRefFromBase64(value.b64_json, value.contentType);
        return makeImageRefFromUrl(value.url);
    }

    // Nested wrappers commonly used by OpenAI-compatible / Gemini gateways
    const nestedCandidates = [
        value.image_url,
        value.imageUrl,
        value.image_uri,
        value.imageUri,
        value.file_url,
        value.fileUrl,
        value.media_url,
        value.mediaUrl,
        value.output_url,
        value.outputUrl,
        value.result_url,
        value.resultUrl,
        value.uri,
        value.href,
        value.link,
        value.src,
    ];
    for (const c of nestedCandidates) {
        if (typeof c === 'string') {
            const hit = makeImageRefFromUrl(c) || (lookLikeBase64Image(c) ? makeImageRefFromBase64(c) : null);
            if (hit) return hit;
        } else if (c && typeof c === 'object') {
            const nestedUrl = pickFirstString(c.url, c.href, c.image_url, c.imageUrl, c.file_url, c.uri, c.src);
            if (nestedUrl) {
                const hit = makeImageRefFromUrl(nestedUrl) || makeImageRefFromBase64(nestedUrl);
                if (hit) return hit;
            }
            const nestedB64 = pickFirstString(
                c.b64_json, c.b64, c.base64, c.image_base64, c.data, c.bytes, c.content,
            );
            if (nestedB64) {
                const hit = makeImageRefFromBase64(nestedB64, c.mime_type || c.mimeType || c.mime || c.content_type);
                if (hit) return hit;
            }
        }
    }

    const directUrl = pickFirstString(
        value.url,
        value.image_url,
        value.imageUrl,
        value.file_url,
        value.fileUrl,
        value.media_url,
        value.output_url,
        value.result_url,
        value.href,
        value.link,
        value.src,
        value.uri,
    );
    if (directUrl) {
        const hit = makeImageRefFromUrl(directUrl);
        if (hit) return hit;
        // Some gateways put base64 into "url"
        const asB64 = makeImageRefFromBase64(directUrl);
        if (asB64) return asB64;
    }

    // Gemini-like inline data
    const inline = value.inlineData || value.inline_data || value.media || value.mediaData || null;
    if (inline && typeof inline === 'object') {
        const b64 = pickFirstString(inline.data, inline.b64_json, inline.base64, inline.image_base64, inline.bytes);
        if (b64) {
            const hit = makeImageRefFromBase64(b64, inline.mimeType || inline.mime_type || inline.mime || inline.content_type);
            if (hit) return hit;
        }
        const u = pickFirstString(inline.url, inline.file_uri, inline.fileUri, inline.uri);
        if (u) {
            const hit = makeImageRefFromUrl(u) || makeImageRefFromBase64(u);
            if (hit) return hit;
        }
    }

    const b64 = pickFirstString(
        value.b64_json,
        value.b64,
        value.base64,
        value.image_base64,
        value.imageBase64,
        value.base64_data,
        value.base64Data,
        value.image_data,
        value.imageData,
        value.data_base64,
        value.dataBase64,
        value.encoded_image,
        value.encodedImage,
        // Gemini candidates often use .data for base64 payload
        (typeof value.data === 'string' && lookLikeBase64Image(value.data) ? value.data : null),
        (typeof value.bytes === 'string' ? value.bytes : null),
    );
    if (b64) {
        const hit = makeImageRefFromBase64(
            b64,
            value.mime_type || value.mimeType || value.mime || value.content_type || value.contentType || value.media_type,
        );
        if (hit) return hit;
    }

    // OpenAI chat-style content part: { type:'image_url', image_url:{url} } / { type:'input_image', image_url }
    if (typeof value.type === 'string') {
        const t = value.type.toLowerCase();
        if (t.includes('image') || t.includes('media') || t === 'output_image') {
            const partUrl = pickFirstString(
                value.image_url,
                value.imageUrl,
                value.url,
                value.image,
                value.file_url,
                value.image_url?.url,
                value.imageUrl?.url,
            );
            if (partUrl) {
                const hit = makeImageRefFromUrl(partUrl) || makeImageRefFromBase64(partUrl);
                if (hit) return hit;
            }
            const partB64 = pickFirstString(value.b64_json, value.base64, value.data, value.image_base64);
            if (partB64) {
                const hit = makeImageRefFromBase64(partB64, value.mime_type || value.mimeType);
                if (hit) return hit;
            }
        }
    }

    // Common one-level wrappers
    for (const key of ['image', 'output', 'result', 'content', 'file', 'media', 'prediction', 'artifact', 'message']) {
        if (value[key] != null && value[key] !== value) {
            const hit = coerceImageRef(value[key], seen);
            if (hit) return hit;
        }
    }

    return null;
}

function collectImageBags(data) {
    const bags = [];
    const pushArr = (v) => { if (Array.isArray(v) && v.length) bags.push(v); };

    if (Array.isArray(data)) bags.push(data);
    if (!data || typeof data !== 'object') return bags;

    pushArr(data.data);
    pushArr(data.images);
    pushArr(data.image);
    pushArr(data.output);
    pushArr(data.outputs);
    pushArr(data.result);
    pushArr(data.results);
    pushArr(data.artifacts);
    pushArr(data.predictions);
    pushArr(data.generated_images);
    pushArr(data.generatedImages);
    pushArr(data.image_urls);
    pushArr(data.imageUrls);
    pushArr(data.files);
    pushArr(data.media);
    pushArr(data.items);
    pushArr(data.choices);
    pushArr(data.candidates);
    pushArr(data.data?.data);
    pushArr(data.data?.images);
    pushArr(data.data?.output);
    pushArr(data.result?.data);
    pushArr(data.output?.data);
    pushArr(data.response?.data);
    pushArr(data.response?.images);
    // Gemini generateContent
    pushArr(data.candidates?.[0]?.content?.parts);
    pushArr(data.candidates?.[0]?.content?.Parts);
    // OpenAI responses / chat
    pushArr(data.choices?.[0]?.message?.content);
    pushArr(data.choices?.[0]?.content);
    pushArr(data.output?.[0]?.content);
    pushArr(data.response?.candidates?.[0]?.content?.parts);

    return bags;
}

function extractFromChatContent(content) {
    if (content == null) return null;
    if (typeof content === 'string') return coerceImageRef(content);
    if (!Array.isArray(content)) return coerceImageRef(content);

    for (const part of content) {
        if (part == null) continue;
        if (typeof part === 'string') {
            const hit = coerceImageRef(part);
            if (hit) return hit;
            continue;
        }
        if (typeof part !== 'object') continue;

        // OpenAI vision/image part shapes
        const hit = coerceImageRef(part);
        if (hit) return hit;

        // { type:'text', text:'...markdown...' }
        if (typeof part.text === 'string') {
            const fromText = coerceImageRef(part.text);
            if (fromText) return fromText;
        }
        if (typeof part.content === 'string') {
            const fromContent = coerceImageRef(part.content);
            if (fromContent) return fromContent;
        }
    }
    return null;
}

function findImageRefDeep(root, { maxNodes = 400 } = {}) {
    if (root == null) return null;
    const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    const queue = [root];
    let steps = 0;

    while (queue.length && steps < maxNodes) {
        const cur = queue.shift();
        steps += 1;
        if (cur == null) continue;

        if (typeof cur === 'string' || typeof cur === 'number' || typeof cur === 'boolean') {
            const hit = coerceImageRef(cur);
            if (hit) return hit;
            continue;
        }

        if (typeof cur !== 'object') continue;
        if (seen) {
            if (seen.has(cur)) continue;
            seen.add(cur);
        }

        const direct = coerceImageRef(cur, seen);
        if (direct) return direct;

        if (Array.isArray(cur)) {
            for (const item of cur) queue.push(item);
            continue;
        }

        // Prefer image-ish keys first for faster hits
        const keys = Object.keys(cur);
        const rank = (k) => {
            const s = k.toLowerCase();
            if (/(b64|base64|image|url|uri|inline|media|file|png|jpeg|webp)/.test(s)) return 0;
            if (/(data|output|result|content|parts|choices|candidates)/.test(s)) return 1;
            return 2;
        };
        keys.sort((a, b) => rank(a) - rank(b));
        for (const k of keys) queue.push(cur[k]);
    }
    return null;
}

function parseImageResponse(data) {
    if (data == null || data === '') {
        throw new Error('生图响应为空');
    }

    // Raw binary image package from fetchJson
    if (data && typeof data === 'object' && data.__stcigRawImage) {
        const rawHit = coerceImageRef(data);
        if (rawHit) return rawHit;
    }

    if (typeof data === 'string') {
        const direct = coerceImageRef(data);
        if (direct) return direct;
    }

    // Fast path: common bags
    const bags = collectImageBags(data);
    for (const list of bags) {
        for (const item of list) {
            const hit = coerceImageRef(item);
            if (hit) return hit;
            // chat content array parts inside bag item
            if (item && typeof item === 'object') {
                const fromContent = extractFromChatContent(item.content)
                    || extractFromChatContent(item.message?.content)
                    || extractFromChatContent(item.parts)
                    || extractFromChatContent(item.delta?.content);
                if (fromContent) return fromContent;
            }
        }
    }

    // Top-level aliases
    const topLevel = coerceImageRef(data)
        || coerceImageRef(data?.data)
        || coerceImageRef(data?.image)
        || coerceImageRef(data?.images)
        || coerceImageRef(data?.output)
        || coerceImageRef(data?.result)
        || coerceImageRef(data?.results)
        || coerceImageRef(data?.file_url)
        || coerceImageRef(data?.image_url)
        || coerceImageRef(data?.url)
        || coerceImageRef(data?.b64_json)
        || coerceImageRef(data?.base64)
        || coerceImageRef(data?.image_base64);
    if (topLevel) return topLevel;

    // Chat / Gemini content paths
    const contentPaths = [
        data?.choices?.[0]?.message?.content,
        data?.choices?.[0]?.content,
        data?.choices?.[0]?.text,
        data?.choices?.[0]?.message?.images,
        data?.output_text,
        data?.candidates?.[0]?.content?.parts,
        data?.candidates?.[0]?.content,
        data?.response?.candidates?.[0]?.content?.parts,
        data?.data?.choices?.[0]?.message?.content,
    ];
    for (const content of contentPaths) {
        const hit = extractFromChatContent(content);
        if (hit) return hit;
    }

    // Deep fallback for exotic gateway envelopes
    const deep = findImageRefDeep(data);
    if (deep) return deep;

    const shape = summarizeResponseShape(data);
    throw new Error(`生图响应中未找到 url 或 b64_json；响应结构: ${shape}`);
}

async function callImageApi(finalPrompt) {
    const base = settings.apiBaseUrl || '';
    const key = settings.apiKey || '';
    const endpoint = settings.apiEndpoint || '/v1/images/generations';
    if (!base) throw new Error('生图 Base URL 未配置');
    if (!key) throw new Error('生图 API Key 未配置');

    const url = buildApiUrl(base, endpoint);
    const body = buildImageRequestBody(finalPrompt);
    log('info', '调用生图 API', { url, model: body.model, size: body.size, n: body.n, base, endpoint });

    const data = await fetchJson(url, {
        headers: authHeaders(key, {
            'Content-Type': 'application/json',
            Accept: 'application/json, image/*, */*',
        }),
        body,
        acceptBinaryImage: true,
    });
    try {
        return parseImageResponse(data);
    } catch (err) {
        // Enrich parse errors with a compact shape for user feedback / logs.
        if (err && err.message && err.message.includes('未找到 url')) {
            try {
                log('warn', '生图响应解析失败', summarizeResponseShape(data));
            } catch (_) { /* ignore */ }
        }
        throw err;
    }
}

function findLatestAiMessageIndex() {
    const ctx = getContextSafe();
    const chat = ctx.chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m) continue;
        if (m.is_user || m.is_system) continue;
        return i;
    }
    return -1;
}

function getMessageByIndex(index) {
    const ctx = getContextSafe();
    const chat = ctx.chat || [];
    if (index < 0 || index >= chat.length) return null;
    return chat[index];
}

function simpleHash(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}

function messageFingerprint(mes, index) {
    // Prefer stable ids; content hash helps once streaming settles.
    const id = mes?.send_date
        || mes?.extra?.api_id
        || mes?.extra?.gen_id
        || mes?.swipe_id
        || '';
    const body = String(mes?.mes || '');
    const bodyHash = simpleHash(body);
    const len = body.length;
    return `${chatKey()}#${index}#${id}#${len}#${bodyHash}`;
}

function rememberProcessedKey(fp) {
    if (!fp) return;
    processedMessageKeys.add(fp);
    while (processedMessageKeys.size > MAX_PROCESSED_KEYS) {
        const first = processedMessageKeys.values().next().value;
        processedMessageKeys.delete(first);
    }
}

function clearPendingAutoTimer() {
    if (pendingAutoTimer) {
        clearTimeout(pendingAutoTimer);
        pendingAutoTimer = null;
    }
}

function schedulePendingAutoRetry(delayMs, reason) {
    clearPendingAutoTimer();
    const wait = Math.max(250, Number(delayMs) || 1000);
    pendingAutoTimer = setTimeout(() => {
        pendingAutoTimer = null;
        const job = pendingAutoJob;
        if (!job) return;
        pendingAutoJob = null;
        log('info', `重试待处理自动生图 (${reason || job.reason || 'pending'})`);
        void handleIncomingMessage(job.messageIndex, { force: false, source: 'auto' });
    }, wait);
}

function queuePendingAuto(messageIndex, fp, reason) {
    pendingAutoJob = { messageIndex, fp, reason };
    let delay = 1200;
    if (reason === '冷却中' && settings.cooldownMs > 0) {
        const remain = settings.cooldownMs - (Date.now() - lastAutoGenAt);
        delay = Math.max(300, Math.min(settings.cooldownMs, remain + 50));
    } else if (reason === '正在生成中') {
        delay = 800;
    }
    schedulePendingAutoRetry(delay, reason);
}

async function persistChat({ preferImmediate = false } = {}) {
    let saved = false;
    // thisArg: window.* functions may rely on `this === window`; bare references pass undefined.
    const tryCall = async (fn, label, thisArg) => {
        if (typeof fn !== 'function') return false;
        try {
            await fn.call(thisArg);
            saved = true;
            return true;
        } catch (err) {
            log('warn', `保存聊天失败 (${label})`, err?.message || err);
            return false;
        }
    };

    if (preferImmediate) {
        if (await tryCall(saveChatConditional, 'saveChatConditional')) return true;
        if (await tryCall(window.saveChatConditional, 'window.saveChatConditional', window)) return true;
        if (await tryCall(window.saveChat, 'window.saveChat', window)) return true;
    }

    try {
        if (typeof saveChatDebounced === 'function') {
            saveChatDebounced();
            saved = true;
            return true;
        }
    } catch (err) {
        log('warn', '保存聊天失败 (saveChatDebounced)', err?.message || err);
    }

    if (!saved) {
        if (await tryCall(saveChatConditional, 'saveChatConditional')) return true;
        if (await tryCall(window.saveChatConditional, 'window.saveChatConditional', window)) return true;
        if (await tryCall(window.saveChatDebounced, 'window.saveChatDebounced', window)) return true;
        if (await tryCall(window.saveChat, 'window.saveChat', window)) return true;
    }

    if (!saved) log('warn', '未找到可用的聊天保存方法');
    return saved;
}

function buildMarkdownImage(imageUrl, alt = 'generated image') {
    const safeAlt = String(alt).replace(/[\[\]]/g, '');
    return `![${safeAlt}](${imageUrl})`;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function insertImageToMessage(messageIndex, imageInfo, usedPrompt) {
    const mes = getMessageByIndex(messageIndex);
    if (!mes) {
        await appendStandaloneImageMessage(imageInfo, usedPrompt);
        return;
    }

    const imageUrl = imageInfo.dataUri || imageInfo.url;
    if (!imageUrl) throw new Error('无可用图片 URL');

    mes.extra = mes.extra || {};
    mes.extra.stcig = mes.extra.stcig || {};
    mes.extra.stcig.lastPrompt = usedPrompt;
    mes.extra.stcig.lastUrl = imageInfo.url || null;
    mes.extra.stcig.updatedAt = Date.now();

    // Strip prompt blocks first, then append the image exactly once.
    if (settings.stripTagsFromDisplay && containsImagePromptBlock(mes.mes)) {
        mes.mes = stripImagePromptTags(mes.mes);
    }
    if (settings.insertAsMarkdown) {
        if (!String(mes.mes || '').includes(imageUrl)) {
            mes.mes = `${String(mes.mes || '').trim()}\n\n${buildMarkdownImage(imageUrl, 'stcig')}`.trim();
        }
    } else {
        mes.extra.image = imageUrl;
        mes.extra.inline_image = true;
    }

    const ok = await persistChat({ preferImmediate: true });
    if (!ok) log('warn', '图片已写入消息对象，但聊天保存可能未成功');
    await refreshMessageDom(messageIndex, mes, imageUrl);
}

async function appendStandaloneImageMessage(imageInfo, usedPrompt) {
    const imageUrl = imageInfo.dataUri || imageInfo.url;
    const md = buildMarkdownImage(imageUrl, 'stcig');
    // HTML comments must not contain "--"; escapeHtml alone does not prevent premature comment close.
    const commentSafePrompt = escapeHtml(usedPrompt).replace(/-{2,}/g, '-').slice(0, 500);
    const text = `${md}\n\n<!-- stcig prompt: ${commentSafePrompt} -->`;

    const ctx = getContextSafe();
    const chat = ctx.chat || window.chat;
    if (!Array.isArray(chat)) {
        toast('info', '图片已生成，但无法写入聊天；请查看日志中的 URL');
        log('info', 'standalone image url', imageUrl.slice(0, 120));
        return;
    }
    chat.push({
        name: 'ImageGen',
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: text,
        extra: { stcig: { lastPrompt: usedPrompt, lastUrl: imageInfo.url || null } },
    });
    const ok = await persistChat({ preferImmediate: true });
    if (!ok) log('warn', '独立图片消息已 push，但聊天保存可能未成功');
    try {
        if (typeof reloadCurrentChat === 'function') await reloadCurrentChat();
        else if (typeof window.reloadCurrentChat === 'function') await window.reloadCurrentChat();
    } catch (_) { /* ignore */ }
}

async function refreshMessageDom(messageIndex, mes, imageUrl) {
    try {
        const root = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`)
            || document.querySelector(`.mes[mesid="${messageIndex}"]`);
        if (root) {
            const textEl = root.querySelector('.mes_text');
            if (textEl) {
                let html = null;
                try {
                    if (typeof messageFormatting === 'function') {
                        html = messageFormatting(mes.mes, mes.name, mes.is_system, mes.is_user, messageIndex);
                    }
                } catch (_) { html = null; }
                if (html) {
                    textEl.innerHTML = html;
                } else if (settings.insertAsMarkdown && !textEl.innerHTML.includes(imageUrl)) {
                    textEl.appendChild(createGeneratedImageEl(imageUrl));
                }
                if (!settings.insertAsMarkdown && !textEl.querySelector('img.stcig-generated-image')) {
                    textEl.appendChild(createGeneratedImageEl(imageUrl));
                }
            }
            ensureMessageButtons(root, messageIndex);
            return;
        }
    } catch (err) {
        log('warn', 'DOM 刷新失败', err?.message || err);
    }

    try {
        if (typeof reloadCurrentChat === 'function') await reloadCurrentChat();
    } catch (_) { /* ignore */ }
}

function createGeneratedImageEl(imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = 'stcig';
    img.className = 'stcig-generated-image';
    return img;
}

function canAutoGenerate() {
    if (!settings.enabled) return { ok: false, reason: '扩展未启用' };
    if (!settings.autoGenerate) return { ok: false, reason: '自动生图已关闭' };
    if (generating) return { ok: false, reason: '正在生成中' };
    const now = Date.now();
    if (settings.cooldownMs > 0 && now - lastAutoGenAt < settings.cooldownMs) {
        return { ok: false, reason: '冷却中' };
    }
    const key = chatKey();
    const count = settings.autoCountByChat[key] || 0;
    if (settings.maxAutoPerChat > 0 && count >= settings.maxAutoPerChat) {
        return { ok: false, reason: `已达自动上限 ${settings.maxAutoPerChat}` };
    }
    return { ok: true };
}

function bumpAutoCount() {
    const key = chatKey();
    settings.autoCountByChat[key] = (settings.autoCountByChat[key] || 0) + 1;
    lastAutoGenAt = Date.now();
    pruneAutoCountMap();
    saveSettings();
}

/**
 * @param {{prompt?: string, source?: string, messageIndex?: number|null, messageText?: string, force?: boolean}} opts
 */
async function generateAndInsert(opts = {}) {
    const source = opts.source || 'manual';
    if (generating) {
        toast('warning', '已有生图任务进行中');
        return null;
    }

    generating = true;
    try {
        if (!settings.enabled && source !== 'manual' && source !== 'test') {
            throw new Error('扩展未启用');
        }

        let rawPrompt = (opts.prompt || '').trim();
        if (!rawPrompt) {
            const messageText = opts.messageText || '';
            const isManual = source === 'manual' || !!opts.force;
            // extractor 模式 / 手动兜底路径会在无标签时调用提取器；
            // callExtractorApi 失败会抛错，无需再次调用（避免重复网络请求）。
            rawPrompt = await extractPromptFromMessage(messageText, {
                forceExtractor: false,
                allowExtractorFallback: settings.promptMode === 'extractor' || isManual,
            });
        }
        if (!rawPrompt) {
            throw new Error('未得到生图提示词（主模式需 <image_prompt> 或 ```stcig-prompt``` 块，或切换 extractor）');
        }

        const finalPrompt = shapeFinalPrompt(rawPrompt);
        if (!finalPrompt) throw new Error('最终提示词为空');

        log('info', `开始生图 (${source})`, finalPrompt.slice(0, 200));
        toast('info', '正在生图...');

        const imageInfo = await callImageApi(finalPrompt);
        log('info', '生图成功', { url: (imageInfo.url || '').slice(0, 120), hasB64: !!imageInfo.b64 });

        let messageIndex = opts.messageIndex;
        if (messageIndex === null || messageIndex === undefined || messageIndex < 0) {
            messageIndex = findLatestAiMessageIndex();
        }

        if (messageIndex >= 0) {
            await insertImageToMessage(messageIndex, imageInfo, finalPrompt);
        } else {
            await appendStandaloneImageMessage(imageInfo, finalPrompt);
        }

        if (source === 'auto') bumpAutoCount();
        toast('success', '生图完成');
        return imageInfo;
    } catch (err) {
        const msg = err?.message || String(err);
        log('error', `生图失败 (${source})`, msg);
        toast('error', `生图失败: ${msg}`);
        return null;
    } finally {
        generating = false;
        if (pendingAutoJob) {
            schedulePendingAutoRetry(400, '生成结束');
        }
    }
}

async function handleIncomingMessage(messageIndex, { force = false, source = 'auto' } = {}) {
    let fp = null;
    let claimed = false;
    try {
        if (!settings.enabled && !force) return;
        const mes = getMessageByIndex(messageIndex);
        if (!mes) return;

        if (settings.onlyAiMessages && (mes.is_user || mes.is_system) && !force) return;

        fp = messageFingerprint(mes, messageIndex);
        if (!force) {
            if (processedMessageKeys.has(fp) || inFlightMessageKeys.has(fp)) return;
        }

        if (settings.stripTagsFromDisplay && settings.promptMode === 'main') {
            maybeStripTagsInDom(messageIndex, mes);
        }

        const messageText = String(mes.mes || '');
        if (!messageText.trim()) return;

        const hasTag = !!extractTaggedPrompt(messageText);
        if (source === 'auto' && settings.promptMode === 'main' && !hasTag) {
            return;
        }

        if (source === 'auto') {
            const gate = canAutoGenerate();
            if (!gate.ok) {
                log('info', `跳过自动生图: ${gate.reason}`);
                if (gate.reason === '冷却中' || gate.reason === '正在生成中') {
                    queuePendingAuto(messageIndex, fp, gate.reason);
                    return;
                }
                if (gate.reason.startsWith('已达自动上限')) {
                    rememberProcessedKey(fp);
                }
                return;
            }
            // Re-check immediately before claim to reduce race with concurrent handlers.
            if (generating) {
                queuePendingAuto(messageIndex, fp, '正在生成中');
                return;
            }
        }

        if (!force) {
            inFlightMessageKeys.add(fp);
            claimed = true;
        }

        const result = await generateAndInsert({
            source: force ? 'manual' : source,
            messageIndex,
            messageText,
            force,
        });

        if (result) {
            rememberProcessedKey(fp);
            if (pendingAutoJob && pendingAutoJob.fp === fp) pendingAutoJob = null;
        }
    } catch (err) {
        log('error', '处理消息失败', err?.message || err);
    } finally {
        if (claimed && fp) inFlightMessageKeys.delete(fp);
    }
}

function maybeStripTagsInDom(messageIndex, mes) {
    try {
        if (!containsImagePromptBlock(mes.mes)) return;
        if (settings.autoGenerate) return;
        const root = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`);
        const textEl = root?.querySelector('.mes_text');
        if (!textEl) return;
        const cleaned = stripImagePromptTags(mes.mes);
        if (typeof messageFormatting === 'function') {
            textEl.innerHTML = messageFormatting(cleaned, mes.name, mes.is_system, mes.is_user, messageIndex);
        }
    } catch (_) { /* ignore */ }
}

async function generateFromLastAiMessage({ force = true } = {}) {
    const idx = findLatestAiMessageIndex();
    if (idx < 0) {
        toast('warning', '未找到 AI 消息');
        return;
    }
    await handleIncomingMessage(idx, { force, source: 'manual' });
}

async function testConnection() {
    readUiIntoSettings();
    saveSettings();
    if (generating) {
        toast('warning', '当前有生图任务进行中，请稍后再测');
        return;
    }
    generating = true;
    try {
        const base = String(settings.apiBaseUrl || '').trim();
        const key = String(settings.apiKey || '').trim();
        const endpoint = String(settings.apiEndpoint || '/v1/images/generations').trim() || '/v1/images/generations';
        if (!base) throw new Error('生图 Base URL 未配置');
        if (!key) log('warn', '未配置 API Key：本地服务可能可用，云端网关常会 401');

        const imageUrl = buildApiUrl(base, endpoint);
        toast('info', '正在测试连接并获取模型列表...');
        log('info', '开始测试连接', { base, endpoint, imageUrl });

        let models = [];
        let modelsUrl = '';
        let modelsOk = false;
        let modelsError = '';
        try {
            const result = await fetchModelList(base, key, { timeoutMs: modelsFetchTimeoutMs() });
            models = result.models || [];
            modelsUrl = result.url || '';
            modelsOk = true;
            populateModelSelectors(models, { selectCurrent: true });
            // If current model empty and list has items, prefill first.
            prefillApiModelIfEmpty(models);
            log('info', `模型列表获取成功（${models.length}）`, { modelsUrl, sample: models.slice(0, 12) });
        } catch (err) {
            modelsError = err?.message || String(err);
            populateModelSelectors([], { selectCurrent: true });
            log('warn', '模型列表获取失败，将继续探测生图端点', modelsError);
        }

        // Lightweight success path: /models is enough for "connection OK".
        // Still do a best-effort endpoint existence tip without spending image credits by default.
        let endpointNote = '';
        try {
            // OPTIONS/GET may not be supported; just report resolved URL for user visibility.
            endpointNote = `生图地址: ${imageUrl}`;
        } catch (_) { /* ignore */ }

        if (modelsOk) {
            toast('success', `连接成功，已加载 ${models.length} 个模型`);
            log('info', '测试连接成功（models）', { modelsUrl, imageUrl, modelCount: models.length });
        } else {
            // Fallback: actual image generation probe when /models unavailable.
            toast('info', '未拿到模型列表，改用生图请求探测...');
            const probePrompt = shapeFinalPrompt(
                settings.sfwEnabled
                    ? 'a simple red apple on a white table, product photo, SFW'
                    : 'a simple red apple on a white table, product photo',
            );
            const imageInfo = await callImageApi(probePrompt);
            toast('success', '生图 API 连接成功（模型列表不可用，可手动填模型）');
            log('info', '测试连接成功（image probe）', {
                imageUrl,
                url: (imageInfo.url || '').slice(0, 120),
                modelsError,
            });
        }

        if (endpointNote) log('info', endpointNote);

        if (settings.promptMode === 'extractor') {
            try {
                const p = await callExtractorApi('A girl stands by the window at dusk, smiling softly.');
                log('info', '提取器测试成功', p.slice(0, 160));
                toast('success', '提取器 API 连接成功');
            } catch (err) {
                toast('warning', `生图侧 OK，但提取器失败: ${err?.message || err}`);
                log('warn', '提取器测试失败', err?.message || err);
            }
        }
    } catch (err) {
        const base = String(settings.apiBaseUrl || '').trim();
        const endpoint = String(settings.apiEndpoint || '/v1/images/generations').trim();
        const imageUrl = base ? buildApiUrl(base, endpoint) : '(no base)';
        const msg = err?.message || String(err);
        toast('error', `测试失败: ${msg}`);
        log('error', '测试连接失败', { message: msg, imageUrl, base, endpoint, status: err?.status });
    } finally {
        generating = false;
        if (pendingAutoJob) schedulePendingAutoRetry(400, '测试结束');
    }
}

function ensureMessageButtons(root, messageIndex) {
    if (!settings.showMessageButtons || !root) return;
    if (root.querySelector('.stcig-msg-actions')) return;
    const controls = root.querySelector('.extraMesButtons')
        || root.querySelector('.mes_buttons')
        || root.querySelector('.mes_block')
        || root;
    const wrap = document.createElement('div');
    wrap.className = 'stcig-msg-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stcig-icon-btn';
    btn.title = '自定义生图：根据此消息生图';
    btn.textContent = '🖼️';
    btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void handleIncomingMessage(Number(messageIndex), { force: true, source: 'manual' });
    });
    wrap.appendChild(btn);
    controls.appendChild(wrap);
}

function bindMessageButtons() {
    if (!settings.showMessageButtons) return;
    // '.mes' alone already matches '#chat .mes'; a single selector avoids double work.
    const nodes = document.querySelectorAll('.mes');
    nodes.forEach((mesEl) => {
        const mesId = mesEl.getAttribute('mesid') ?? mesEl.dataset.mesid;
        if (mesId == null) return;
        ensureMessageButtons(mesEl, Number(mesId));
    });
}

function bindEvents() {
    if (eventsBound) {
        log('info', '事件监听已绑定，跳过重复绑定');
        return;
    }
    if (!eventSource || !event_types) {
        log('warn', '未找到 eventSource / event_types，自动生图事件不可用（手动仍可用）');
        return;
    }
    eventsBound = true;

    const onMsg = (idx) => {
        const index = typeof idx === 'number' ? idx : Number(idx);
        void handleIncomingMessage(Number.isFinite(index) ? index : findLatestAiMessageIndex(), {
            force: false,
            source: 'auto',
        });
        bindMessageButtons();
    };

    if (event_types.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMsg);
    }
    if (event_types.CHARACTER_MESSAGE_RENDERED) {
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (idx) => {
            bindMessageButtons();
            // avoid double fire if MESSAGE_RECEIVED already handled; still useful on some builds
            if (!event_types.MESSAGE_RECEIVED) onMsg(idx);
        });
    }
    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, () => {
            // only as fallback when message index events are missing
            if (!event_types.MESSAGE_RECEIVED && !event_types.CHARACTER_MESSAGE_RENDERED) {
                onMsg(findLatestAiMessageIndex());
            }
        });
    }
    if (event_types.MESSAGE_UPDATED) {
        eventSource.on(event_types.MESSAGE_UPDATED, () => bindMessageButtons());
    }
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            processedMessageKeys.clear();
            inFlightMessageKeys.clear();
            pendingAutoJob = null;
            clearPendingAutoTimer();
            bindMessageButtons();
            applyExtensionPromptInjection();
            updateStatusBadges();
        });
    }
    log('info', '事件监听已绑定');
}


function tryLoadPromptsDefaults() {
    try {
        applyPromptDefaults({ forceTemplates: false, forcePrefix: false });
    } catch (_) { /* ignore */ }
}

function loadPromptsScript() {
    return new Promise((resolve) => {
        if (window.STCustomImageGenPrompts) {
            resolve(true);
            return;
        }
        const base = getExtensionBasePath();
        const candidates = [
            `${base}prompts.js`,
            ...getExtensionFolderCandidates().map((f) => `/scripts/extensions/third-party/${f}/prompts.js`),
        ];
        try {
            const scripts = Array.from(document.getElementsByTagName('script'));
            for (const s of scripts) {
                const srcAttr = s.src || '';
                if (/third-party/i.test(srcAttr) && /index\.js/i.test(srcAttr)) {
                    candidates.unshift(srcAttr.replace(/index\.js(?:\?.*)?$/i, 'prompts.js'));
                }
            }
        } catch (_) { /* ignore */ }

        const uniq = [...new Set(candidates.filter(Boolean))];
        const tryNext = (i) => {
            if (i >= uniq.length) {
                log('warn', 'prompts.js 未加载（将使用内置默认模板）', uniq.slice(0, 4));
                resolve(false);
                return;
            }
            const script = document.createElement('script');
            script.src = uniq[i];
            script.async = true;
            script.onload = () => {
                log('info', `prompts.js 已加载: ${uniq[i]}`);
                resolve(true);
            };
            script.onerror = () => {
                // Remove the dead script node before trying the next candidate.
                try { script.remove(); } catch (_) { /* ignore */ }
                tryNext(i + 1);
            };
            document.head.appendChild(script);
        };
        tryNext(0);
    });
}

async function initExtension() {
    if (extensionInitialized) {
        log('info', '扩展已初始化，跳过重复加载');
        return;
    }
    try {
        console.log(`[${MODULE_NAME}] booting from`, getExtensionBasePath(), 'rel=', getExtensionRelativeName());
        await loadSillyTavernApis();
        loadSettings();
        await loadPromptsScript();
        tryLoadPromptsDefaults();
        const injected = await injectSettingsPanel({ allowBodyFallback: false });
        // 即使首次成功，也注册长观察，防止 ST 重绘扩展区后面板丢失（尤其手机端）
        scheduleSettingsPanelRetry();
        if (!injected) {
            log('warn', '首次设置面板注入未成功，已安排重试');
        }
        scheduleWandMenuButton();
        bindEvents();
        bindMessageButtons();
        applyExtensionPromptInjection();
        updateStatusBadges();
        extensionInitialized = true;
        try {
            window.STCustomImageGen = {
                name: DISPLAY_NAME,
                module: MODULE_NAME,
                version: EXTENSION_VERSION,
                relativeName: getExtensionRelativeName(),
                getSettings: () => settings,
                openSettings: () => openSettingsPanel(),
                reinjectSettings: () => injectSettingsPanel({ allowBodyFallback: true }),
            };
        } catch (_) { /* ignore */ }
        log('info', `${DISPLAY_NAME} v${EXTENSION_VERSION} 已加载`);
        toast('info', `${DISPLAY_NAME} 已加载。请到「扩展」抽屉查找本面板；若没有，先打开「管理扩展」确认已启用`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] init failed`, err);
        toast('error', `初始化失败: ${err?.message || err}`);
        try { scheduleSettingsPanelRetry(); } catch (_) { /* ignore */ }
        try { scheduleWandMenuButton(); } catch (_) { /* ignore */ }
    }
}

function bootWhenReady() {
    // Match official third-party extensions: jQuery(async () => { ... })
    const start = () => { void initExtension(); };
    try {
        if (typeof jQuery === 'function') {
            jQuery(async () => { start(); });
            return;
        }
    } catch (_) { /* ignore */ }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
        return;
    }
    start();
}

// Extra safety: if the module evaluated, expose a tiny pre-init hook immediately.
try {
    window.STCustomImageGen = window.STCustomImageGen || {
        name: DISPLAY_NAME,
        module: MODULE_NAME,
        version: EXTENSION_VERSION,
        booting: true,
        openSettings: () => openSettingsPanel(),
        reinjectSettings: () => injectSettingsPanel({ allowBodyFallback: true }),
    };
} catch (_) { /* ignore */ }

bootWhenReady();
