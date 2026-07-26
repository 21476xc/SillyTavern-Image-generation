# ST-Custom-ImageGen

> **找不到插件面板？**
> 1. 先确认已更新到 **1.1.6+**（1.1.3 有模块语法错误，安装后设置面板不会出现）。
> 2. 打开 **扩展 → 管理扩展**，找到 `自定义生图 (OpenAI 兼容)` / `SillyTavern-Image-generation`，确认开关为启用，然后硬刷新。
> 3. 设置面板在扩展设置列表里（和其他第三方扩展一起），不是单独新页面。
> 4. 手机浏览器可看日志：搜索 `st-custom-imagegen` 或 `Invalid regular expression flags`。

SillyTavern 第三方扩展：**自定义生图（OpenAI 兼容）**。

在角色扮演过程中，自动或手动调用兼容 OpenAI Images API 的服务生成图片，并插入到对话消息中。支持两种提示词来源模式、SFW 约束、独立提取 API，以及消息级手动重生成。

当前版本：**1.1.6**

---

## 安装（重要）

### 方式 A：GitHub 链接安装（推荐）

1. 打开 SillyTavern → **扩展 (Extensions)** 页
2. 找到 **Install Extension / 安装扩展**，粘贴：

```text
https://github.com/21476xc/SillyTavern-Image-generation
```

3. 安装成功后会出现 toast：`自定义生图 (OpenAI 兼容)`
4. 点 **管理扩展 (Manage Extensions)**，在 **Installed Extensions** 列表里找到同名项，确认开关为 **开启**
5. 关闭管理弹窗后，在扩展设置区（`#extensions_settings2`）找到同名抽屉面板
6. 也可点聊天输入栏旁的 **魔杖菜单**，里面有「自定义生图 (OpenAI 兼容)」快捷入口

> GitHub 安装后文件夹名通常是 `SillyTavern-Image-generation`，这是正常的，**不必改名**。

### 方式 B：手动复制

把本仓库整个文件夹放到下面任一位置（保持 `manifest.json` 在文件夹根目录）：

```text
SillyTavern/public/scripts/extensions/third-party/<文件夹名>/
# 或用户扩展目录（非 global 安装）：
SillyTavern/data/<用户名>/extensions/<文件夹名>/
```

推荐文件夹名：

```text
SillyTavern-Image-generation
ST-Custom-ImageGen
```

### 找不到插件时按这个顺序查

1. **扩展列表不在左侧常驻**，要在扩展页点 **管理扩展** 才能看到第三方列表
2. 管理扩展里如果有本扩展但开关关闭 → 先打开，然后 **保存/重载页面**
3. 浏览器 F12 控制台搜索：`st-custom-imagegen`
   - 有 `booting from ...` = JS 已加载
   - 有 `failed to load` / import error = 看报错
4. 控制台执行：
   ```js
   window.STCustomImageGen?.openSettings?.()
   // 或
   window.STCustomImageGen?.reinjectSettings?.()
   ```
5. 确认安装 toast 出现过；若安装失败，多半是网络/git 或仓库不可达

### 设置面板位置

- **扩展设置** 主区域（第三方扩展通常在 `extensions_settings2`）
- **魔杖菜单** → 自定义生图
- 控制台 `window.STCustomImageGen.openSettings()`

---

## 1.1.6 修复

- **手机端模型列表可点选**：新增真正的 `<select>` 下拉，不再只依赖桌面浏览器的 datalist。
- **独立「获取模型列表」按钮**：可单独刷新模型，不必走完整测试。
- **生图响应解析增强**：兼容嵌套 `image_url`、chat content parts、Gemini `inlineData`/`inline_data`、多种 base64/url 别名，以及直接返回图片二进制的网关（含错误 Content-Type 时的字节嗅探）。
- **错误信息更明确**：解析失败时附带响应结构摘要，方便继续排查。

## 1.1.5 修复

- **修复测试连接 404 / not found**：当 Base URL 已带 `/v1`（如 `http://127.0.0.1:2156/v1`），且 Endpoint 为 `/v1/images/generations` 时，旧版会拼成 `/v1/v1/...`。现已自动去重。
- **测试连接优先拉取模型列表**：成功后把 API 返回的模型填入 Model 下拉（仍可手输任意模型名，兼容 Gemini 等网关）。
- 推荐配置任选其一：
  - Base: `http://127.0.0.1:2156/v1` + Endpoint: `/images/generations`
  - Base: `http://127.0.0.1:2156/v1` + Endpoint: `/v1/images/generations`（自动去重，也可）
  - Base: `http://127.0.0.1:2156` + Endpoint: `/v1/images/generations`

## 功能概览

| 能力 | 说明 |
|------|------|
| OpenAI 兼容生图 | `Base URL` + `API Key` + `Model` + `Endpoint`（默认 `/v1/images/generations`，自动避免双 `/v1`） |
| 测试连接 / 模型列表 | 优先 `GET /models`，成功后可选任意返回模型，也可手输 |
| 主模式 `main` | 向主对话注入指令；解析回复中的提示词块后生图 |
| 提取模式 `extractor` | 消息生成后，另调 Chat Completions 提炼生图提示词 |
| SFW 模式 | 注入/提取约束 + 敏感词替换 + 额外 negative + 简短 SFW 描述 |
| 自动 / 手动 | 事件自动触发；设置页手动；消息旁 🖼️ 强制重生成 |
| 提示词拼装 | `prefix` + 主体 + `suffix`，另附 negative |
| 其它 | 冷却、每聊天自动上限、超时、测试连接、日志、恢复默认模板 |

设置修改后会自动写入（`input` / `change`）；「保存设置」只是显式确认，不是唯一保存入口。

---

## 两种提示词模式

### 1. 主模式（`promptMode = main`）

**流程：**

1. 扩展通过 `setExtensionPrompt` 把「输出生图提示词块」的指令注入主对话上下文。
2. 角色正常回复；若本回合有明确画面，在文末追加提示词块。
3. 消息落盘后扩展解析该块 → 拼装 prefix / suffix / negative → 调用生图 API → 把图片附到消息。

**同时识别两种块（大小写不敏感）：**

```xml
<image_prompt>
1girl, red coat, standing in rain, neon street, cinematic lighting
</image_prompt>
```

````markdown
```stcig-prompt
1girl, red coat, standing in rain, neon street, cinematic lighting
```
````

**默认注入文案**来自 `index.js` 的 `DEFAULT_MAIN_INJECTION`（中文说明，优先 `<image_prompt>`，并支持 ` ```stcig-prompt` 围栏块，含 `{{char}}` / `{{user}}` / `{{sfw_constraint}}`）。  
`prompts.js` 的 `MAIN_MODE_INJECT_TEMPLATE` 仍可作为额外中文参考模板，**不会在启动时自动覆盖**主模式注入；点「恢复提示词模板默认」会回到 `DEFAULT_MAIN_INJECTION`。

**优点**

- 少一次 LLM 调用，延迟与费用更低
- 提示词与当前叙事同一模型产出，风格更连贯

**缺点**

- 依赖主模型服从格式；模型跑题时会「有剧情无提示词块」
- 与角色卡 / 世界书抢上下文，注入过长可能被挤掉

### 2. 提取模式（`promptMode = extractor`）

**流程：**

1. 主模型只负责角色扮演，**不要求**输出特殊块。
2. 消息生成完成后，扩展用「提取 API」另发一次 Chat Completions：
   - System：设置里的 `extractorSystemPrompt`（空时回落到 `prompts.js` / 内置默认）
   - User：`prompts.js` 的 `EXTRACTOR_USER_TEMPLATE`（运行时填入 `{{char}}` / `{{user}}` / `{{history}}` / `{{message}}` 等；**设置页不可直接编辑**）
3. 用返回的纯文本提示词去生图。若返回里仍带标签/围栏，会再尝试剥离。

补充行为：

- 提取模式下，若消息里已经带有合法提示词块，会优先用块内容，不再额外调用提取器（除非强制路径）。
- 可勾选「提取器复用生图 API 的 Base/Key」；关闭后使用提取器自己的 Base / Key（留空仍回落生图侧）。
- 提取器 Endpoint 默认 `/v1/chat/completions`。

**优点**

- 不污染角色文风；主模型不用学格式
- 提取器可固定用便宜小模型，提示词更稳定
- 对「主模型经常漏块」更稳

---

## SFW 模式

开启 `stcig_sfwEnabled` 后会：

1. **主模式**：在注入文本末尾追加 `SFW REQUIREMENT`（使用设置里的 SFW 约束文本）。
2. **提取模式**：把 `{{sfw_constraint}}` 填入模板；若 system 中尚未包含该段，再追加一节 `SFW:`。
3. **最终提示词**：按敏感词表做替换（默认替换为 `[sfw]`）。
4. **最终提示词**：若约束文本较短（≤180 字）会并入 image prompt；过长则改用简短英文 SFW 描述，避免撑爆生图 prompt。
5. **negative**：把 `prompts.js` 的 `SFW_EXTRA_NEGATIVE` 合并进去并去重。

适用：接入带审核的商用生图接口，降低拒生概率。关闭 SFW 时不做上述约束与替换。

---

## 提示词拼装与占位符

最终生图 prompt 顺序大致为：

```text
[prefix] + [主体提示词] + [suffix] + (可选 Avoid: negative)
```

- 主体来自主模式标签块、提取器输出，或手动输入。
- 若勾选「负向提示词优先作为字段发送」，会在请求体里带 `negative_prompt` 与 `negativePrompt`；否则拼进 prompt 的 `Avoid:` 段。
- 点「填入 prefix/suffix/negative 默认」会从 `prompts.js` 写入：
  - `DEFAULT_PROMPT_PREFIX`
  - `DEFAULT_PROMPT_SUFFIX`
  - `DEFAULT_NEGATIVE_PROMPT`
- 点「恢复提示词模板默认」会：
  - 主模式注入 → `index.js` 的 `DEFAULT_MAIN_INJECTION`
  - 提取器 system / SFW 约束 → 优先 `prompts.js` 对应模板

`fillTemplate` 支持的占位符（未解析到的 `{{...}}` 会被清空）：

| 占位符 | 常见用途 |
|--------|----------|
| `{{char}}` / `{{user}}` | 角色名 / 用户名 |
| `{{message}}` | 待提取的最新消息 |
| `{{history}}` | 近期对话摘要 |
| `{{scene}}` | 附加场景备注（当前默认为空） |
| `{{prefix}}` / `{{suffix}}` / `{{style}}` | 画风前后缀（`style` 目前等同 prefix） |
| `{{negative}}` | 生效后的负向提示词 |
| `{{sfw_constraint}}` | SFW 开启时的约束文本 |

---

## 生图 API 约定

请求（概念上）：

```http
POST {BaseURL}{Endpoint}
Authorization: Bearer {API Key}
Content-Type: application/json
```

```json
{
  "model": "dall-e-3",
  "prompt": "...",
  "n": 1,
  "size": "1024x1024",
  "response_format": "url"
}
```

- `quality` / `style` 仅在设置非空时发送。
- `response_format = auto` 时**不**发送该字段（由服务端默认；解析仍兼容 url / b64）。
- 「额外 JSON Body」会 `Object.assign` 合并进请求体（需为 JSON 对象）。

响应解析兼容：

- `data[0].url` / `data[0].b64_json`
- 部分网关的 `images` / `output` / 顶层 `url` / `image` / base64 变体

图片写入：

- 默认以 Markdown `![]()` 追加到消息文本（`insertAsMarkdown`）
- 也可写入 `extra.image`（关闭 Markdown 插入时）
- 可选剥离消息中的提示词标签再展示（`stripTagsFromDisplay`）

---

## 设置页字段（运行时 ID）

运行时 UI 优先加载本目录的 `settings.html`（同目录 fetch / `renderExtensionTemplateAsync`）；仅当模板加载失败时才回退到 `index.js` → `buildSettingsHtml()` 的内置精简面板。  
因此 `settings.html` 的 ID 与文案必须与 `index.js` 保持一致。

### 总控

| ID | 含义 |
|----|------|
| `stcig_enabled` | 启用扩展 |
| `stcig_autoGenerate` | 自动生图 |
| `stcig_onlyAiMessages` | 仅处理 AI 消息 |
| `stcig_stripTagsFromDisplay` | 剥离展示中的提示词标签 |
| `stcig_insertAsMarkdown` | 以 Markdown 插入图片 |
| `stcig_showMessageButtons` | 显示消息旁手动按钮 |
| `stcig_status_badge` / `stcig_mode_badge` / `stcig_sfw_badge` | 状态徽章 |

### 生图 API

| ID | 含义 |
|----|------|
| `stcig_apiBaseUrl` / `stcig_apiKey` / `stcig_apiModel` / `stcig_apiEndpoint` | 生图 API |
| `stcig_size` / `stcig_quality` / `stcig_style` / `stcig_n` | 尺寸、质量、风格、张数 |
| `stcig_responseFormat` | `url` / `b64_json` / `auto` |
| `stcig_extraBodyJson` | 额外 JSON Body |
| `stcig_sendNegativeAsField` | negative 作为字段发送 |
| `stcig_btn_test` / `stcig_btn_save` | 测试连接 / 保存设置 |

### 提示词模式与提取器

| ID | 含义 |
|----|------|
| `stcig_promptMode` | `main` / `extractor` |
| `stcig_mainInjectionPrompt` | 主模式注入文本 |
| `stcig_mainInjectionDepth` / `stcig_mainInjectionPosition` | 注入深度与位置（`in_prompt` / `in_chat`） |
| `stcig_extractorUseMainCredentials` | 提取器复用生图 Base/Key |
| `stcig_extractorBaseUrl` / `stcig_extractorApiKey` | 提取器独立凭证 |
| `stcig_extractorModel` / `stcig_extractorEndpoint` | 提取器模型与路径 |
| `stcig_extractorSystemPrompt` | 提取器 system |
| `stcig_extractorTemperature` / `stcig_extractorMaxTokens` | 提取采样参数 |
| `stcig_btn_reset_templates` | 恢复提示词模板默认 |
| `stcig_btn_load_prompt_defaults` | 填入 prefix/suffix/negative 默认 |

### 提示词处理 / SFW / 限制 / 手动 / 日志

| ID | 含义 |
|----|------|
| `stcig_promptPrefix` / `stcig_promptSuffix` / `stcig_negativePrompt` | 拼装 |
| `stcig_sfwEnabled` / `stcig_sfwConstraint` | SFW 开关与约束 |
| `stcig_sfwSensitiveWords` / `stcig_sfwReplaceWith` | 敏感词与替换串 |
| `stcig_cooldownMs` / `stcig_maxAutoPerChat` / `stcig_timeoutMs` | 冷却、次数上限、超时 |
| `stcig_manual_prompt` | 手动提示词 |
| `stcig_btn_manual` / `stcig_btn_from_last` / `stcig_btn_reset_count` | 手动生成相关 |
| `stcig_log` / `stcig_btn_clear_log` | 日志 |

---

## 使用建议

1. 先填 Base URL / Key / Model，点 **测试连接**（会按当前模式顺带验证提取器，若启用 extractor）。
2. 主模型指令跟随较好 → 用 **main**；经常漏标签 → 用 **extractor**。
3. 商用审核严 → 开 **SFW**，并检查敏感词表是否过宽（过宽会误伤正常词）。
4. 需要统一画风 → 设 prefix/suffix，或点「填入默认」。
5. 单条消息可点消息旁 🖼️ 按钮，强制按该条重生成（仍受启用状态与 API 配置约束）。
6. 自动生图受冷却与「每聊天最大自动次数」限制；手动路径不占用/不依赖同一自动计数策略时，仍会走统一生成入口与日志。

---

## 常见问题

**有剧情但不生图**

- 主模式：确认回复里有 `<image_prompt>` 或 ` ```stcig-prompt` 块
- 确认「启用扩展」「自动生图」已开，且未处于冷却 / 次数上限
- 若开了「仅 AI 消息」，用户消息不会触发
- 查看扩展日志面板与浏览器控制台 `[st-custom-imagegen]`

**测试连接失败**

- Base URL 是否含 `https://`，是否多/少了 `/v1`（Endpoint 默认已含 `/v1/...`）
- Endpoint 是否应为 `/v1/images/generations` 或厂商自定义路径
- Key 权限、模型名、跨域/代理是否正常

**提取模式失败但生图 OK**

- 提取器是否复用了**不支持** Chat Completions 的生图 Base
- 为提取器单独配置兼容 `/v1/chat/completions` 的地址与模型
- 取消勾选「提取器复用生图 API 的 Base/Key」

**图片不显示**

- 若 API 只返回临时 URL，可改 `response_format=b64_json`
- 确认「以 Markdown 插入图片」或 `extra.image` 路径是否被主题/CSS 屏蔽
- 查看日志中的 URL / 报错

**恢复默认后主模式注入变了**

- 预期行为：`恢复提示词模板默认` 写回 `index.js` 的 `DEFAULT_MAIN_INJECTION`（当前为中文双格式说明）
- 若想用 `prompts.js` 的另一份中文参考，可从 `MAIN_MODE_INJECT_TEMPLATE` 复制到设置框

---

## 文件说明

| 文件 | 作用 |
|------|------|
| `manifest.json` | ST 扩展清单（`js` / `css` / 显示名 / 版本） |
| `index.js` | 主逻辑：设置 UI、事件、API、插入图片、内置默认文案 |
| `style.css` | 设置面板与消息按钮样式 |
| `prompts.js` | 默认可选模板，挂到 `window.STCustomImageGenPrompts` |
| `settings.html` | 设置面板模板（运行时优先加载；失败时回退内置面板） |
| `test_parse_image_response.js` | 本地自测：`node ST-Custom-ImageGen/test_parse_image_response.js` 验证生图响应解析 |

模块名：`st-custom-imagegen`  
显示名：`自定义生图 (OpenAI 兼容)`  
导入路径（相对 third-party 扩展）：

- `../../../extensions.js`
- `../../../../script.js`

---

## 版本

当前：`1.1.6`（见 `manifest.json`；本地扩展，无强制联网更新）

### 1.1.4
- **关键修复**：`getExtensionBasePath()` 的回退返回值误写成了非法正则字面量，导致 `index.js` 作为 ES Module 解析失败；ST 激活扩展失败后，设置面板完全不会注入
- 回退路径改为合法字符串：`/scripts/extensions/third-party/SillyTavern-Image-generation/`
- 强化 base path 解析、jQuery 启动时机、设置面板 jQuery append
- 暴露 `window.STCustomImageGen` 预初始化钩子，便于控制台强制打开/重注面板

### 1.1.1
- 补全/恢复 `style.css` 设置面板与消息按钮样式
- 主模式默认注入改为中文双格式说明
- 初始化防重入、事件绑定防重复、超时/网络错误更清晰
- 自动生图冷却/忙碌队列、聊天切换清理 in-flight 状态
- `prompts.js` 多路径回退加载；提取器字段在 main 模式下禁用
