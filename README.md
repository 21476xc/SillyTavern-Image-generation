# ST-Custom-ImageGen

SillyTavern 第三方扩展：**自定义生图（OpenAI 兼容）**。

在角色扮演过程中，自动或手动调用兼容 OpenAI Images API 的服务生成图片，并插入到对话消息中。支持两种提示词来源模式、SFW 约束、独立提取 API，以及消息级手动重生成。

---

## 安装（重要）

SillyTavern **不会**从任意目录自动扫描插件。必须放进第三方扩展目录，并在扩展页启用。

### 正确安装路径

把本仓库**整个文件夹**复制到：

```text
SillyTavern/public/scripts/extensions/third-party/<任意文件夹名>
```

推荐文件夹名（任选其一，保持文件夹内有 `manifest.json`）：

```text
ST-Custom-ImageGen
SillyTavern-Image-generation
```

例如：

```text
SillyTavern/public/scripts/extensions/third-party/ST-Custom-ImageGen/manifest.json
SillyTavern/public/scripts/extensions/third-party/ST-Custom-ImageGen/index.js
SillyTavern/public/scripts/extensions/third-party/ST-Custom-ImageGen/style.css
SillyTavern/public/scripts/extensions/third-party/ST-Custom-ImageGen/prompts.js
```

> 如果你是 `git clone` 本仓库，文件夹名可能是 `SillyTavern-Image-generation`，**也可以直接用这个名字**，不必改成 `ST-Custom-ImageGen`。  
> 不要只复制 `index.js` 单个文件；不要放到 `data/`、`plugins/`、仓库根目录等错误位置。

### 启用与找到设置面板

1. **完全重启** SillyTavern（仅刷新有时不够，尤其是新装扩展）。
2. 打开左侧/顶部的 **扩展 (Extensions)** 页面。
3. 在第三方扩展列表中找到 **「自定义生图 (OpenAI 兼容)」**，先 **启用/勾选**。
4. 启用后，到 **扩展设置** 区域查找同名抽屉面板（`自定义生图 (OpenAI 兼容)`）。
5. 填写 Base URL / API Key / Model，点「测试连接」。

如果扩展列表里完全没有这项：

- 检查 `manifest.json` 是否在 `public/scripts/extensions/third-party/<文件夹>/` 下
- 打开浏览器控制台 (F12)，搜索 `st-custom-imagegen` 看是否有加载错误
- 确认 ST 版本支持第三方扩展，且未开启“禁用未验证扩展”之类限制

如果扩展已启用但找不到设置：

- 在扩展设置页向下滚动，查找 `自定义生图`
- 控制台执行：`window.STCustomImageGen?.reinjectSettings?.()`
- 看控制台是否打印 `[st-custom-imagegen] booting from ...`

`prompts.js` 会按当前扩展实际路径加载，并回退常见目录名。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| OpenAI 兼容生图 | `Base URL` + `API Key` + `Model` + `Endpoint`（默认 `/v1/images/generations`） |
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

运行时 UI 由 `index.js` → `buildSettingsHtml()` 生成并注入扩展设置区。  
`settings.html` 仅作对照骨架，ID 与文案应与运行时保持一致，但 **不会** 被 SillyTavern 自动加载。

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
| `settings.html` | 设置骨架参考（不运行时加载） |

模块名：`st-custom-imagegen`  
显示名：`自定义生图 (OpenAI 兼容)`  
导入路径（相对 third-party 扩展）：

- `../../../extensions.js`
- `../../../../script.js`

---

## 版本

当前：`1.1.2`（见 `manifest.json`；本地扩展，无强制联网更新）

### 1.1.2
- 修复“安装后找不到”：动态加载 ST API，避免顶层 import 失败导致整扩展不出现
- 设置面板支持重试/容器监听注入；暴露 `window.STCustomImageGen`
- 安装路径/仓库文件夹名自适应（含 `SillyTavern-Image-generation`）
- README 明确：必须放 third-party 并在扩展页启用

### 1.1.1
- 补全/恢复 `style.css` 设置面板与消息按钮样式
- 主模式默认注入改为中文双格式说明
- 初始化防重入、事件绑定防重复、超时/网络错误更清晰
- 自动生图冷却/忙碌队列、聊天切换清理 in-flight 状态
- `prompts.js` 多路径回退加载；提取器字段在 main 模式下禁用
