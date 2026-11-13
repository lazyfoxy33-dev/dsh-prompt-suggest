# 同类插件与 DSH 下一句建议生态

预测用户输入框里的“下一句”并不是本项目独有。本页记录写作时的生态，方便读者自行比较，也避免本项目
把已有想法包装成首创。

快照日期：**2026-11-13**。链接、star 和下载量只作背景参考，不构成推荐；生态变化很快。

## 概况

- 本项目目标版本范围内的 DSH 没有内置下一句建议；这类功能由社区插件提供。
- 在 GitHub 上可搜到 **20–30 个**直接实现“回复完成后预测下一句”的项目；看到的仓库大多在
  2026 年 9–11 月有更新。
- 对一个常用社区目录
  [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 做宽泛关键词扫描，
  有 **80+ 条**提到 next-prompt、灰字、输入预测、后续建议、Tab 采纳或 composer 建议；其中不少是
  prompt 改写、历史回滚等相邻功能。排除后，直接同类约 **30 个**。
- npm 下载量显示少数项目已有实际使用：`dsh-nextsteps` 约 **4.4k 次/周**，
  `dsh-prompt-predict` 约 **1.7k 次/周**，`dsh-composer-assistant` 约 **554 次/周**，
  `dsh-prompt-for-me` 约 **340 次/周**（npm 下载 API，截至 2026-11-11 当周；含自动化和镜像流量）。
- 插件市场目录收录并不完整。公开的 1024 市场当时搜索 `next prompt` 只有 1 条结果；没被目录收录
  不代表不存在。

## 直接同类：输入框灰字 + Tab

| 项目 | 交互 | 分发 / 热度（快照） |
|---|---|---|
| [dsh-prompt-predict](https://github.com/ferrisching/dsh-prompt-predict) | 输入框灰字，Tab 采纳、Esc 忽略，可换一条。 | npm，约 1.7k 次/周，4 star |
| [dsh-next-prompt](https://github.com/Tleon-H/dsh-next-prompt) | 回合后灰字；Tab 或右方向键采纳；空输入框按 ↑/↓ 翻历史。 | npm，约 329 次/周 |
| [prompt-for-me](https://github.com/ChuanTianML/prompt-for-me) | 自动灰字 + 手动触发；可接受、编辑、重新生成；模型可固定。 | npm，约 340 次/周，5 star |
| [dsh-prompt-suggestions](https://github.com/nzl153/dsh-prompt-suggestions) | 空输入框灰字，Tab 填入，Esc 忽略；按界面语言生成。 | GitHub 安装 |
| [dsh-prompt-suggestion](https://github.com/GoldenLoaf24h/dsh-prompt-suggestion) | 按键最全：Tab 整句、Alt+→ 逐词、Enter 采纳并发送、Alt+R 重试、历史补全、设置页。 | GitHub 安装 |
| [dsh-prompt-suggestion](https://github.com/zycFrancis/dsh-prompt-suggestion) | Claude Code 风格灰字，Tab 采纳，Esc 关闭。 | GitHub 安装 |
| [dsh-prompt-suggest](https://github.com/Linsongrong/dsh-prompt-suggest) | 内联预测 + ↑/↓ 历史回滚。 | GitHub 安装 |
| [dsh-next-prompt](https://github.com/ckqqqq/dsh-next-prompt) | 按会话、默认关闭的本地学习，可选模型预测。 | GitHub 安装 |
| [dsh-suggest-ghost](https://github.com/dsh-plugin-collection/dsh-suggest-ghost) | 输入预测 + Tab 采纳 + 历史前缀补全。 | GitHub 安装 |

## 多条建议 / 卡片

| 项目 | 交互 | 说明 |
|---|---|---|
| [dsh-nextsteps](https://github.com/klaus-2/dsh-nextsteps) | 每轮回复下约 3 张后续卡片，**点击即发送**。 | npm 约 4.4k 次/周；与本项目“只填入不发送”不同 |
| [dsh-next-step-suggest](https://github.com/anye-99/dsh-next-step-suggest) | 输入框上方 3 条 chips，点击填入。 | GitHub 安装 |
| [dsh-suggest-actions](https://github.com/hiJoeLee/dsh-suggest-actions) | 回复下最多 5 条可点击下一步，可发送或填入。 | GitHub 安装 |
| [dsh-input-prediction](https://github.com/fishcg/dsh-input-prediction) | 草稿灰字续写 + 每轮 1–3 条候补建议。 | GitHub 安装 |

## 包含预测能力的输入助手套装

| 项目 | 组合能力 |
|---|---|
| [dsh-composer-assistant](https://github.com/Mr-Elk/dsh-composer-assistant) | 下一句预测 + 输入续写 + prompt 优化。 |
| [dsh-composer-predictions](https://github.com/Stijnus/dsh-composer-predictions) | 灰字预测 + 草稿续写 + 候选项切换。 |
| [dsh-composer-suggest](https://github.com/WuweiRE/dsh-composer-suggest) | 灰字预测 + 草稿续写 + 候选项切换，支持输入框里的图片。 |
| [dsh-suggest-prompt](https://github.com/studyzy/dsh-suggest-prompt) | 把一条建议写进会话日志，输入框以 placeholder 展示。 |

## 本项目的差异

`dsh-prompt-suggest` 只做较窄的一段：

- **输入框上方的独立建议行**，而不是输入框内的灰字。更显眼、不占草稿光标；视觉上也更重。
- **Tab 或点击填入草稿，绝不发送。** 没有 Enter 直接发送路径；像 `dsh-nextsteps` 这类项目则刻意
  优化成“点击即发送”。
- **本地采纳/忽略记录 + 学习数据页。** 统计展示、采纳、忽略次数，保留有上限的采纳/忽略示例，
  并据此调整后续提示。这是偏好条件化，**不是训练模型或微调权重**。
- **模型可控。** 默认跟随会话最近一次模型路由，也可在配置中固定 `provider`/`model`。
- **8 个界面语言**，深浅色跟随宿主。

相对上述项目的取舍：

- 一次只给一条建议；没有候选项切换、逐词采纳、手动“再建议一次”、↑/↓ 历史回滚。
- 仅 Web 界面。
- 已发布到 npm（`dsh-prompt-suggest`），同时也支持 GitHub 与 Discover 安装。
- 占用输入框的 Tab，不能与另一个同样占用 Tab 的建议插件共存。

## 兼容性提醒

不要在同一个 profile 里安装两个都绑定输入框 Tab 的建议插件（例如本项目与
`dsh-composer-predictions`、`dsh-composer-suggest` 或其他灰字预测插件）。常见症状是 Tab 被其中一个
抢走、建议被插入两次，或其中一个完全不生效。不确定时在干净的 profile 中测试。

## 方法与边界

- 检索了 GitHub 仓库与代码中的 `dsh`、`prompt`、`suggest`、`next prompt`、`ghost text`、
  `composer`、`autocomplete` 及中文对应词，并检索了一个 DSH 社区插件目录。
- 排除了明确写明“尚无实现”的计划型仓库；部分低 star 仓库没有逐一审计。
- star 与下载量是快照，可能过时或被刷量；下载量含自动化/镜像流量，只能粗略判断使用情况。
- 本页不是排名，也不保证列出的项目仍在维护或兼容当前 DSH 版本。

## 主要来源

- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) — 社区目录
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [npm 下载 API](https://api.npmjs.org/downloads/point/last-week/dsh-nextsteps)
- 上表链接的各项目仓库
