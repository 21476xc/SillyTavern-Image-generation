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
const EXTENSION_VERSION = '1.1.5';
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
const IMAGE_PROMPT_GLOBAL_RE = /<image_prompt>\s*[\s\S]*?\s*<\/image_prompt>/gi;

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
    try {
        saveSettingsDebounced();
    } catch (_) {
        try { window.saveSettingsDebounced?.(); } catch (__) { /* ignore */ }
    }
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
      <label class="stcig-field"><span>Model</span><input type="text" id="stcig_apiModel" list="stcig_apiModel_list" placeholder="测试连接后可下拉选择"><datalist id="stcig_apiModel_list"></datalist><div id="stcig_model_fetch_hint" class="stcig-hint">点击「测试连接」可自动拉取模型列表</div></label>
      <label class="stcig-field"><span>Endpoint</span><input type="text" id="stcig_apiEndpoint"></label>
    </div>
    <div class="stcig-actions">
      <div class="menu_button" id="stcig_btn_save">保存设置</div>
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
    const ordered = [
        () => document.getElementById('extensions_settings2'),
        () => document.querySelector('#extensions_settings2'),
        () => document.getElementById('extensions_settings'),
        () => document.querySelector('#extensions_settings'),
        () => document.querySelector('#extensions_settings2 .extensions_block'),
        () => document.querySelector('#extensions_settings .extensions_block'),
        () => document.getElementById('rm_extensions_block'),
        () => document.querySelector('#rm_extensions_block'),
    ];
    for (const get of ordered) {
        try {
            const host = get();
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
    const preferred = document.getElementById('extensions_settings2') || document.querySelector('#extensions_settings2');
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
            || document.querySelector('#extensionsMenu')
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

    const ids = [
        'enabled', 'autoGenerate', 'onlyAiMessages', 'stripTagsFromDisplay', 'insertAsMarkdown', 'showMessageButtons',
        'apiBaseUrl', 'apiKey', 'apiModel', 'apiEndpoint', 'size', 'quality', 'style', 'n', 'responseFormat', 'extraBodyJson', 'sendNegativeAsField',
        'promptMode', 'mainInjectionPrompt', 'mainInjectionDepth', 'mainInjectionPosition',
        'extractorUseMainCredentials', 'extractorBaseUrl', 'extractorApiKey', 'extractorModel', 'extractorEndpoint',
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
    const bool = (id) => !!$(id)?.checked;
    const val = (id) => $(id)?.value ?? '';
    const num = (id, fallback) => {
        const n = Number($(id)?.value);
        return Number.isFinite(n) ? n : fallback;
    };

    settings.enabled = bool('stcig_enabled');
    settings.autoGenerate = bool('stcig_autoGenerate');
    settings.onlyAiMessages = bool('stcig_onlyAiMessages');
    settings.stripTagsFromDisplay = bool('stcig_stripTagsFromDisplay');
    settings.insertAsMarkdown = bool('stcig_insertAsMarkdown');
    settings.showMessageButtons = bool('stcig_showMessageButtons');

    settings.apiBaseUrl = val('stcig_apiBaseUrl').trim();
    settings.apiKey = val('stcig_apiKey');
    settings.apiModel = val('stcig_apiModel').trim();
    settings.apiEndpoint = val('stcig_apiEndpoint').trim() || '/v1/images/generations';
    settings.size = val('stcig_size').trim();
    settings.quality = val('stcig_quality');
    settings.style = val('stcig_style');
    settings.n = clampInt(num('stcig_n', 1), 1, 4, 1);
    settings.responseFormat = normalizeEnum(val('stcig_responseFormat') || 'url', ['url', 'b64_json', 'auto'], 'url');
    settings.extraBodyJson = val('stcig_extraBodyJson');
    settings.sendNegativeAsField = bool('stcig_sendNegativeAsField');

    settings.promptMode = normalizeEnum(val('stcig_promptMode') || 'main', ['main', 'extractor'], 'main');
    settings.mainInjectionPrompt = val('stcig_mainInjectionPrompt');
    settings.mainInjectionDepth = clampInt(num('stcig_mainInjectionDepth', 0), 0, 99, 0);
    settings.mainInjectionPosition = normalizeEnum(
        val('stcig_mainInjectionPosition') || 'in_prompt',
        ['in_prompt', 'in_chat'],
        'in_prompt',
    );

    settings.extractorUseMainCredentials = bool('stcig_extractorUseMainCredentials');
    settings.extractorBaseUrl = val('stcig_extractorBaseUrl').trim();
    settings.extractorApiKey = val('stcig_extractorApiKey');
    settings.extractorModel = val('stcig_extractorModel').trim();
    settings.extractorEndpoint = val('stcig_extractorEndpoint').trim() || '/v1/chat/completions';
    settings.extractorSystemPrompt = val('stcig_extractorSystemPrompt');
    settings.extractorTemperature = clampNumber(num('stcig_extractorTemperature', 0.4), 0, 2, 0.4);
    settings.extractorMaxTokens = clampInt(num('stcig_extractorMaxTokens', 400), 32, 4000, 400);

    settings.promptPrefix = val('stcig_promptPrefix');
    settings.promptSuffix = val('stcig_promptSuffix');
    settings.negativePrompt = val('stcig_negativePrompt');

    settings.sfwEnabled = bool('stcig_sfwEnabled');
    settings.sfwConstraint = val('stcig_sfwConstraint');
    settings.sfwSensitiveWords = val('stcig_sfwSensitiveWords');
    settings.sfwReplaceWith = val('stcig_sfwReplaceWith');

    settings.cooldownMs = clampInt(num('stcig_cooldownMs', 3000), 0, 600000, 3000);
    settings.maxAutoPerChat = clampInt(num('stcig_maxAutoPerChat', 0), 0, 9999, 0);
    settings.timeoutMs = clampInt(num('stcig_timeoutMs', 120000), 5000, 600000, 120000);
    settings.manualPrompt = val('stcig_manual_prompt');
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
        'stcig_extractorModel', 'stcig_extractorEndpoint', 'stcig_extractorSystemPrompt',
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

function fillModelDatalist(datalistId, models, currentValue) {
    const list = document.getElementById(datalistId);
    if (!list) return 0;
    const ids = Array.isArray(models) ? models.slice() : [];
    const cur = String(currentValue || '').trim();
    if (cur && !ids.includes(cur)) ids.unshift(cur);
    list.innerHTML = '';
    for (const id of ids) {
        const opt = document.createElement('option');
        opt.value = id;
        list.appendChild(opt);
    }
    return ids.length;
}

function populateModelSelectors(models, { selectCurrent = true } = {}) {
    const ids = Array.isArray(models) ? models.filter(Boolean) : [];
    const n1 = fillModelDatalist('stcig_apiModel_list', ids, settings.apiModel);
    const n2 = fillModelDatalist('stcig_extractorModel_list', ids, settings.extractorModel);
    const hint = $('stcig_model_fetch_hint');
    if (hint) {
        hint.textContent = ids.length
            ? `已加载 ${ids.length} 个模型，可下拉选择或继续手输`
            : '未获取到模型列表，可手动填写模型名';
    }
    if (selectCurrent) {
        const modelInput = $('stcig_apiModel');
        if (modelInput && settings.apiModel) modelInput.value = settings.apiModel;
        const extInput = $('stcig_extractorModel');
        if (extInput && settings.extractorModel) extInput.value = settings.extractorModel;
    }
    return Math.max(n1, n2, ids.length);
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

async function fetchJson(url, { method = 'POST', headers = {}, body, timeoutMs } = {}) {
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
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
        if (!res.ok) {
            const msg = extractApiErrorMessage(data, res.statusText, res.status);
            const err = new Error(`${msg} (${method} ${url})`);
            err.status = res.status;
            err.data = data;
            err.url = url;
            throw err;
        }
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

function coerceImageRef(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return null;
        if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:')) {
            return { url: s, b64: null, dataUri: s.startsWith('data:') ? s : null };
        }
        if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, '').length > 64) {
            const clean = s.replace(/\s+/g, '');
            const dataUri = `data:image/png;base64,${clean}`;
            return { url: dataUri, b64: clean, dataUri };
        }
        return null;
    }
    if (typeof value === 'object') {
        const url = value.url || value.image_url || value.imageUrl || value.href || null;
        let b64 = value.b64_json || value.b64 || value.base64 || value.image_base64 || null;
        if (typeof url === 'string' && url.trim()) {
            const u = url.trim();
            if (u.startsWith('data:')) return { url: u, b64: null, dataUri: u };
            return { url: u, b64: null, dataUri: null };
        }
        if (typeof b64 === 'string' && b64.trim()) {
            b64 = b64.trim();
            if (b64.startsWith('data:')) return { url: b64, b64: null, dataUri: b64 };
            const dataUri = `data:image/png;base64,${b64}`;
            return { url: dataUri, b64, dataUri };
        }
        if (typeof value.image === 'string') return coerceImageRef(value.image);
    }
    return null;
}

function parseImageResponse(data) {
    if (!data) throw new Error('生图响应为空');
    if (typeof data === 'string') {
        const direct = coerceImageRef(data);
        if (direct) return direct;
    }

    const bags = [];
    if (Array.isArray(data)) bags.push(data);
    if (Array.isArray(data?.data)) bags.push(data.data);
    if (Array.isArray(data?.images)) bags.push(data.images);
    if (Array.isArray(data?.output)) bags.push(data.output);
    if (Array.isArray(data?.result)) bags.push(data.result);
    if (Array.isArray(data?.results)) bags.push(data.results);
    if (Array.isArray(data?.data?.data)) bags.push(data.data.data);

    for (const list of bags) {
        for (const item of list) {
            const hit = coerceImageRef(item);
            if (hit) return hit;
        }
    }

    const topLevel = coerceImageRef(data)
        || coerceImageRef(data?.data)
        || coerceImageRef(data?.image)
        || coerceImageRef(data?.output)
        || coerceImageRef(data?.result);
    if (topLevel) return topLevel;

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
        const md = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[a-zA-Z+.-]+;base64,[^)\s]+)\)/);
        if (md) {
            const u = md[1];
            return { url: u, b64: null, dataUri: u.startsWith('data:') ? u : null };
        }
        const bare = content.match(/(https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?)/i);
        if (bare) return { url: bare[1], b64: null, dataUri: null };
    }

    throw new Error('生图响应中未找到 url 或 b64_json');
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
        headers: authHeaders(key, { 'Content-Type': 'application/json' }),
        body,
    });
    return parseImageResponse(data);
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
    const tryCall = async (fn, label) => {
        if (typeof fn !== 'function') return false;
        try {
            await fn();
            saved = true;
            return true;
        } catch (err) {
            log('warn', `保存聊天失败 (${label})`, err?.message || err);
            return false;
        }
    };

    if (preferImmediate) {
        if (await tryCall(saveChatConditional, 'saveChatConditional')) return true;
        if (await tryCall(window.saveChatConditional, 'window.saveChatConditional')) return true;
        if (await tryCall(window.saveChat, 'window.saveChat')) return true;
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
        if (await tryCall(window.saveChatConditional, 'window.saveChatConditional')) return true;
        if (await tryCall(window.saveChatDebounced, 'window.saveChatDebounced')) return true;
        if (await tryCall(window.saveChat, 'window.saveChat')) return true;
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

    if (settings.insertAsMarkdown) {
        const md = buildMarkdownImage(imageUrl, 'stcig');
        if (!String(mes.mes || '').includes(imageUrl)) {
            mes.mes = `${String(mes.mes || '').trim()}\n\n${md}`.trim();
        }
    } else {
        mes.extra.image = imageUrl;
        mes.extra.inline_image = true;
    }

    if (settings.stripTagsFromDisplay) {
        const rawMes = String(mes.mes || '');
        if (/<image_prompt>[\s\S]*?<\/image_prompt>/i.test(rawMes) || /```stcig-prompt/i.test(rawMes)) {
            mes.mes = stripImagePromptTags(mes.mes);
            if (settings.insertAsMarkdown && !String(mes.mes || '').includes(imageUrl)) {
                mes.mes = `${String(mes.mes || '').trim()}\n\n${buildMarkdownImage(imageUrl, 'stcig')}`.trim();
            }
        }
    }

    const ok = await persistChat({ preferImmediate: true });
    if (!ok) log('warn', '图片已写入消息对象，但聊天保存可能未成功');
    await refreshMessageDom(messageIndex, mes, imageUrl);
}

async function appendStandaloneImageMessage(imageInfo, usedPrompt) {
    const imageUrl = imageInfo.dataUri || imageInfo.url;
    const md = buildMarkdownImage(imageUrl, 'stcig');
    const text = `${md}\n\n<!-- stcig prompt: ${escapeHtml(usedPrompt).slice(0, 500)} -->`;

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
                    const img = document.createElement('img');
                    img.src = imageUrl;
                    img.alt = 'stcig';
                    img.className = 'stcig-generated-image';
                    textEl.appendChild(img);
                }
            }
            if (!settings.insertAsMarkdown) {
                const textNode = root.querySelector('.mes_text');
                if (textNode && !textNode.querySelector('img.stcig-generated-image')) {
                    const img = document.createElement('img');
                    img.src = imageUrl;
                    img.alt = 'stcig';
                    img.className = 'stcig-generated-image';
                    textNode.appendChild(img);
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
            rawPrompt = await extractPromptFromMessage(messageText, {
                forceExtractor: false,
                allowExtractorFallback: settings.promptMode === 'extractor' || isManual,
            });
            if (!rawPrompt && settings.promptMode === 'extractor') {
                rawPrompt = await extractPromptFromMessage(messageText, {
                    forceExtractor: true,
                    allowExtractorFallback: true,
                });
            }
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
        const raw = String(mes.mes || '');
        if (!/<image_prompt>[\s\S]*?<\/image_prompt>/i.test(raw) && !/```stcig-prompt/i.test(raw)) return;
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
            const result = await fetchModelList(base, key, { timeoutMs: Math.min(settings.timeoutMs || 120000, 30000) });
            models = result.models || [];
            modelsUrl = result.url || '';
            modelsOk = true;
            populateModelSelectors(models, { selectCurrent: true });
            // If current model empty and list has items, prefill first.
            if (!settings.apiModel && models.length) {
                settings.apiModel = models[0];
                const el = $('stcig_apiModel');
                if (el) el.value = models[0];
                saveSettings();
            }
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
    const nodes = document.querySelectorAll('#chat .mes, .mes');
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
            script.onerror = () => tryNext(i + 1);
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
