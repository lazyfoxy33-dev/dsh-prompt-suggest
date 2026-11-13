# Prior art and the DSH next-prompt ecosystem

The idea of predicting the user's next composer message is **not unique to this project**. This page records
the landscape at the time of writing so that readers can choose knowingly, and so this project does not
overclaim novelty.

Snapshot date: **2026-11-13**. Links, stars, and download figures are context, not endorsements; the
ecosystem changes quickly.

## Summary

- DSH has no built-in next-prompt suggestion in the versions this plugin targets; the feature is supplied by
  community plugins.
- GitHub search finds **20–30 direct implementations** of "predict the next message after a completed turn";
  most repositories seen were updated in September–November 2026.
- A broad keyword scan of a widely used community directory
  ([awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)) returned **80+ entries**
  mentioning next-prompt, ghost text, input prediction, follow-up suggestions, Tab acceptance, or composer
  suggestions. Many of those are adjacent (prompt rewriting, history, unrelated tools); after excluding
  them, roughly **30** are direct alternatives.
- Package downloads show meaningful adoption for a few projects. `dsh-nextsteps` had about **4.4k npm
  downloads/week**, `dsh-prompt-predict` about **1.7k/week**, `dsh-composer-assistant` about
  **554/week**, and `dsh-prompt-for-me` about **340/week** (npm download API, week ending 2026-11-11;
  figures include automation and mirror traffic).
- Plugin-market catalogs are incomplete. A snapshot of the public 1024 market search returned only one
  result for `next prompt`; absence from a catalog is not evidence that a plugin does not exist.

## Direct alternatives: ghost text in the composer + Tab

| Project | Interaction | Distribution / heat (snapshot) |
|---|---|---|
| [dsh-prompt-predict](https://github.com/ferrisching/dsh-prompt-predict) | Ghost text in the composer, Tab accepts, Esc dismisses, can request another suggestion. | npm, ~1.7k downloads/week, 4 stars |
| [dsh-next-prompt](https://github.com/Tleon-H/dsh-next-prompt) | Ghost text after a turn; Tab or Right Arrow accepts; empty composer Up/Down recalls sent prompts. | npm, ~329 downloads/week |
| [prompt-for-me](https://github.com/ChuanTianML/prompt-for-me) | Automatic ghost suggestion plus a manual trigger; accept, edit, or regenerate; suggestion model follows the session or can be pinned. | npm, ~340 downloads/week, 5 stars |
| [dsh-prompt-suggestions](https://github.com/nzl153/dsh-prompt-suggestions) | Empty-composer ghost text, Tab to fill, Esc to dismiss; suggestion generated in the UI language. | GitHub |
| [dsh-prompt-suggestion](https://github.com/GoldenLoaf24h/dsh-prompt-suggestion) | Rich keys: Tab accepts the line, Alt+Right accepts word by word, Enter accepts and sends, Alt+R asks again, history completion; settings page. | GitHub |
| [dsh-prompt-suggestion](https://github.com/zycFrancis/dsh-prompt-suggestion) | Claude-Code-style ghost text, Tab accepts, Esc dismisses. | GitHub |
| [dsh-prompt-suggest](https://github.com/Linsongrong/dsh-prompt-suggest) | Inline prediction plus Up/Down prompt history. | GitHub |
| [dsh-next-prompt](https://github.com/ckqqqq/dsh-next-prompt) | Per-session, opt-in local learning from observed prompt pairs; optional model prediction. | GitHub |
| [dsh-suggest-ghost](https://github.com/dsh-plugin-collection/dsh-suggest-ghost) | Input prediction with Tab acceptance and prefix completion from history. | GitHub |

## Multiple suggestions / cards

| Project | Interaction | Notes |
|---|---|---|
| [dsh-nextsteps](https://github.com/klaus-2/dsh-nextsteps) | About three follow-up cards under every finished turn; **clicking sends** the prompt. | ~4.4k npm downloads/week; sends immediately, unlike this plugin |
| [dsh-next-step-suggest](https://github.com/anye-99/dsh-next-step-suggest) | Three clickable chips above the composer; clicking fills the draft. | GitHub |
| [dsh-suggest-actions](https://github.com/hiJoeLee/dsh-suggest-actions) | Up to five clickable next steps under a reply; click to send or fill. | GitHub |
| [dsh-input-prediction](https://github.com/fishcg/dsh-input-prediction) | Ghost completion of the draft plus 1–3 follow-up suggestions after each turn. | GitHub |

## Composer suites that include prediction

| Project | What it bundles |
|---|---|
| [dsh-composer-assistant](https://github.com/Mr-Elk/dsh-composer-assistant) | Next-message prediction, draft continuation, and prompt enhancement. |
| [dsh-composer-predictions](https://github.com/Stijnus/dsh-composer-predictions) | Ghost text, inline draft completion, and candidate cycling. |
| [dsh-composer-suggest](https://github.com/WuweiRE/dsh-composer-suggest) | Ghost text, draft completion, candidate cycling, and attached images. |
| [dsh-suggest-prompt](https://github.com/studyzy/dsh-suggest-prompt) | Writes one suggested next prompt into the session log; composer renders it as a placeholder. |

## How this project is different

`dsh-prompt-suggest` occupies a narrower slice:

- **A separate suggestion row above the composer**, not inline ghost text inside the draft. It is more
  visible and never competes with the draft for the caret; it is also visually heavier.
- **Tab (or click) fills the draft; it never sends.** There is no Enter-to-send path. Plugins such as
  `dsh-nextsteps` deliberately optimize for one-click sending instead.
- **A local accept/dismiss record with a Learning data page.** The plugin counts shown/accepted/dismissed
  suggestions, keeps bounded accepted/dismissed examples, and conditions later prompts on them. This is
  preference conditioning, **not** model training or fine-tuning.
- **Explicit model control.** It follows the session's last model route by default and can be pinned with
  `provider`/`model` in configuration.
- **Eight UI locales** and a light/dark-adaptive UI.

Trade-offs compared with the projects above:

- Only one suggestion at a time; no candidate cycling, word-by-word acceptance, manual "suggest again"
  button, or prompt history recall (Up/Down).
- Web surface only.
- Published on npm as `dsh-prompt-suggest`; GitHub and Discover installs are also supported.
- It binds Tab in the composer, so it cannot coexist with another plugin that also claims Tab for
  suggestions.

## Compatibility warning

Do not install two plugins that both bind Tab in the composer (for example this plugin plus
`dsh-composer-predictions`, `dsh-composer-suggest`, or another ghost-text predictor). Symptoms include
double acceptance, one plugin winning the key, or suggestions being inserted twice. Test in a clean
profile if unsure.

## Method and limits

- Searched GitHub repositories and code for `dsh`, `prompt`, `suggest`, `next prompt`, `ghost text`,
  `composer`, `autocomplete`, and Chinese equivalents, and searched a curated DSH plugin directory.
- Excluded repositories explicitly describing themselves as unimplemented plans; some low-star repos were
  not individually audited.
- Stars and downloads are snapshots and can be gamed or stale. Download figures include automation/mirror
  traffic and are only a rough adoption signal.
- This page is not a ranking and does not claim that every listed project is maintained or compatible with
  the same DSH version.

## Primary sources

- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) — community directory
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [npm downloads API](https://api.npmjs.org/downloads/point/last-week/dsh-nextsteps)
- Project repositories linked in the tables above
