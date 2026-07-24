/**
 * ST-Custom-ImageGen 提示词模板模块
 *
 * 运行时由 index.js 通过 <script> 加载，并挂到：
 *   window.STCustomImageGenPrompts
 *
 * 主模式解析支持两种块（index.js extractTaggedPrompt）：
 *   1) <image_prompt>...</image_prompt>   （index.js DEFAULT_MAIN_INJECTION 默认推荐）
 *   2) ```stcig-prompt ... ```             （本文件亦提供示例）
 *
 * 注意：
 * - 启动时不会用 MAIN_MODE_INJECT_TEMPLATE 覆盖设置里的主模式注入。
 * - 「恢复提示词模板默认」会把主模式注入写回 index.js 的 DEFAULT_MAIN_INJECTION。
 * - EXTRACTOR_SYSTEM_PROMPT / SFW_CONSTRAINT / DEFAULT_PROMPT_* 会在空值或恢复默认时被采用。
 * - EXTRACTOR_USER_TEMPLATE 仅运行时使用，设置页不可直接编辑。
 *
 * 占位符（fillTemplate 运行时替换；未匹配的 {{...}} 会被清空）：
 *   {{char}} {{user}} {{message}} {{history}} {{scene}} {{style}}
 *   {{sfw_constraint}} {{prefix}} {{suffix}} {{negative}}
 */

'use strict';

/** 主模式：中文参考注入模板（可手动粘贴到「主模式注入提示」） */
const MAIN_MODE_INJECT_TEMPLATE = [
  '你正在进行角色扮演。除正常叙事外，请在「有明确可视画面」时附带生图提示词。',
  '',
  '规则：',
  '1. 先完整输出角色扮演正文，不要中断剧情，不要用 OOC 解释生图。',
  '2. 仅当本回合出现清晰、可画的一帧画面时，在正文末尾追加 1 个提示词块；无新画面则不要输出块。',
  '3. 优先使用 XML 标签（推荐，兼容性最好）：',
  '',
  '<image_prompt>',
  'subject, appearance, clothing, pose, expression, setting, lighting, camera angle, art style, quality tags',
  '</image_prompt>',
  '',
  '4. 也可使用围栏代码块（二选一，不要两种都写）：',
  '',
  '```stcig-prompt',
  '1girl, red coat, standing in rain, neon street, wet asphalt reflections, cinematic lighting',
  '```',
  '',
  '5. 块内只写纯画面提示词：以英文短语为主，逗号分隔；不要对话、不要解释、不要假装已经出图。',
  '6. 内容应具体可视：人物外貌与服装、姿态表情、环境道具、光影与构图；避免抽象情绪堆砌。',
  '7. 同一条回复最多 1 个提示词块。',
  '8. 角色名：{{char}}；用户名：{{user}}。',
  '{{sfw_constraint}}',
].join('\n');

/** 提取模式：独立 LLM 的 system prompt（可被「恢复模板默认」写入设置） */
const EXTRACTOR_SYSTEM_PROMPT = [
  '你是专业的 AI 绘画提示词提取器（Prompt Extractor）。',
  '任务：阅读角色扮演对话与最新消息，提炼「一张」最能代表当前关键画面的生图提示词。',
  '',
  '输出要求：',
  '1. 只输出最终提示词本身：不要解释、不要标题、不要引号、不要 markdown 代码围栏、不要 XML 标签。',
  '2. 以英文短语为主，逗号分隔；专有名词/角色独特称谓可保留原文。',
  '3. 结构建议：主体 → 外貌/发型/五官 → 服装/配饰 → 动作/表情 → 环境/背景/道具 → 构图/镜头 → 光影/氛围/画质。',
  '4. 总长度约 40–120 个英文词；信息密度高，避免空泛形容词刷屏。',
  '5. 忽略 OOC、系统指令、与画面无关的 meta 讨论；不要复述剧情对白。',
  '6. 若多画面并存，选择叙事焦点最强、最值得定格的一帧。',
  '7. 若原文几乎无可视信息，可基于文本合理补全一个得体、可画的场景，但仍需贴合角色与情境。',
  '8. 不要输出 negative prompt（负面提示词由扩展另行拼接）。',
  '{{sfw_constraint}}',
].join('\n');

/** 提取模式：user 消息模板（仅运行时 fillTemplate，设置页不展示） */
const EXTRACTOR_USER_TEMPLATE = [
  '角色：{{char}}',
  '用户：{{user}}',
  '',
  '近期上下文：',
  '{{history}}',
  '',
  '待提取的最新消息：',
  '{{message}}',
  '',
  '附加场景备注（可为空）：',
  '{{scene}}',
  '',
  '期望画风/前缀（可为空，请自然融入，不要原样重复整段）：',
  '{{prefix}}',
  '',
  '请输出一张图的英文生图提示词：',
].join('\n');

/**
 * SFW 模式约束
 * 说明：该文本会进入注入/提取 system；若较长，写入最终 image prompt 时会被截成短描述。
 */
const SFW_CONSTRAINT = [
  '【SFW 安全约束 — 必须遵守】',
  '- 仅生成全年龄向、安全可公开的画面描述。',
  '- 禁止色情、裸露、性暗示、性器官、性行为、恋童、过度血腥与虐杀特写。',
  '- 着装保持得体完整；若原文偏成人向，请改写为含蓄、服装完整的 equivalent 画面。',
  '- 不要使用 NSFW / nude / explicit 等词，也不要用隐晦拼写、隐喻或「艺术裸露」绕过限制。',
].join('\n');

const DEFAULT_NEGATIVE_PROMPT = [
  'lowres', 'bad anatomy', 'bad hands', 'missing fingers', 'extra digits', 'fewer digits',
  'cropped', 'worst quality', 'low quality', 'jpeg artifacts', 'blurry', 'watermark',
  'text', 'error', 'deformed', 'mutated', 'ugly', 'poorly drawn face', 'extra limbs',
  'nsfw', 'nude', 'explicit',
].join(', ');

const DEFAULT_PROMPT_PREFIX = [
  'masterpiece', 'best quality', 'highly detailed', 'sharp focus',
].join(', ');

const DEFAULT_PROMPT_SUFFIX = [
  'cinematic lighting', 'beautiful composition', 'depth of field',
].join(', ');

/** SFW 开启时合并进 negative（去重） */
const SFW_EXTRA_NEGATIVE = [
  'nsfw', 'nude', 'naked', 'explicit', 'sexual', 'porn', 'genitalia', 'nipples', 'cleavage focus',
].join(', ');

const PROMPT_BLOCK_FENCE = 'stcig-prompt';
const PROMPT_BLOCK_REGEX = /```stcig-prompt\s*([\s\S]*?)```/i;
const IMAGE_PROMPT_TAG_REGEX = /<image_prompt>\s*([\s\S]*?)\s*<\/image_prompt>/i;

const STCustomImageGenPrompts = {
  MAIN_MODE_INJECT_TEMPLATE,
  EXTRACTOR_SYSTEM_PROMPT,
  EXTRACTOR_USER_TEMPLATE,
  SFW_CONSTRAINT,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_PROMPT_PREFIX,
  DEFAULT_PROMPT_SUFFIX,
  SFW_EXTRA_NEGATIVE,
  PROMPT_BLOCK_FENCE,
  PROMPT_BLOCK_REGEX,
  IMAGE_PROMPT_TAG_REGEX,
};

if (typeof window !== 'undefined') {
  window.STCustomImageGenPrompts = STCustomImageGenPrompts;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = STCustomImageGenPrompts;
}
