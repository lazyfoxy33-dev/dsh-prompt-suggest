window.__ModuleLoader__.load({
  id: 'dsh-prompt-suggest',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    /** Layout effect keeps the Tab bridge fresh before paint when the bar appears. */
    const useLayoutEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect;

    /** Locale namespace owned by the browser half. */
    const NS = 'prompt-suggest';
    /** Host route `/api/prompt.suggest` in the browser-relative form the shipped packages use. */
    const SUGGEST_ROUTE = 'api/prompt.suggest';
    /** Quiet period between the composer becoming eligible and one suggestion request. */
    const DEBOUNCE_MS = 250;
    /** Defensive upper bound for a suggestion rendered on one line (Host caps at 512). */
    const MAX_SUGGESTION_CHARS = 512;
    /** The composer's editable surface (owned by @deepseek-ai/dsh-client-ui-conversation). */
    const COMPOSER_INPUT_SELECTOR = '[data-composer-input]';
    /** The composer seat that holds both this dock entry and its composer. */
    const COMPOSER_SEAT_SELECTOR = '[data-composer-seat]';
    /** Style-tag identity; disposal removes exactly the tag this plugin created. */
    const STYLE_TAG_ID = 'dsh-prompt-suggest/SuggestionBar.css';

    /** Host route receiving fire-and-forget shown/accept/dismiss/reset feedback. */
    const FEEDBACK_ROUTE = 'api/prompt.suggest.feedback';

    /** Shared id of the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'prompt-suggest-learning';
    /** Host route serving the read-only learning record. */
    const LEARNING_ROUTE = 'api/prompt.suggest.learning';
    /** Rows rendered per recent-activity list (the Host already bounds its list). */
    const MAX_LEARNING_ROWS = 12;

    //#region dictionaries
    /** Simplified Chinese copy. */
    const zh = {
      'key.tab': 'Tab',
      'hint': '按 Tab 使用',
      'accept': '使用建议的提示',
      'dismiss': '隐藏建议',
      'dismissReset': 'Shift+点击清空学习记录',
      'suggestion': '下一步提示建议',
      'panel.label': '学习数据',
      'page.title': '学习数据',
      'page.intro': '这些记录只保存在本机配置（~/.dsh/storages/prompt_suggest_learning.json），用于调整后续的提示建议；不包含任何对话内容。',
      'stat.rate': '采纳率',
      'stat.shown': '展示次数',
      'stat.accepted': '采纳次数',
      'stat.dismissed': '忽略次数',
      'stat.percent': '{pct}%',
      'stat.noRate': '—',
      'section.accepted': '最近采纳',
      'section.dismissed': '最近忽略',
      'section.emptyAccepted': '暂无采纳记录',
      'section.emptyDismissed': '暂无忽略记录',
      'state.loading': '正在读取学习记录…',
      'state.error': '无法读取学习记录。',
      'empty.title': '还没有学习记录',
      'empty.desc': '采纳或忽略提示建议后，这里会显示统计和最近记录。',
      'action.retry': '重试',
      'action.refresh': '刷新',
      'action.clear': '清空学习记录',
      'action.clearConfirm': '确认清空？',
      'action.clearing': '正在清空…',
      'action.clearFailed': '清空失败，请重试。',
      'time.justNow': '刚刚',
      'time.minutesAgo': '{count} 分钟前',
      'time.hoursAgo': '{count} 小时前',
      'time.daysAgo': '{count} 天前',
      'time.monthsAgo': '{count} 个月前',
      'time.yearsAgo': '{count} 年前',
    };
    /** English copy (fallback for every locale). */
    const en = {
      'key.tab': 'Tab',
      'hint': 'Tab to use',
      'accept': 'Use suggested prompt',
      'dismiss': 'Hide suggestion',
      'dismissReset': 'Shift+click to clear learned suggestions',
      'suggestion': 'Suggested prompt',
      'panel.label': 'Learning data',
      'page.title': 'Learning data',
      'page.intro': 'The record is stored locally in your profile (~/.dsh/storages/prompt_suggest_learning.json) and tunes later suggestions. It never contains conversation content.',
      'stat.rate': 'Acceptance rate',
      'stat.shown': 'Shown',
      'stat.accepted': 'Accepted',
      'stat.dismissed': 'Dismissed',
      'stat.percent': '{pct}%',
      'stat.noRate': '—',
      'section.accepted': 'Recently accepted',
      'section.dismissed': 'Recently dismissed',
      'section.emptyAccepted': 'No accepted suggestions yet',
      'section.emptyDismissed': 'No dismissed suggestions yet',
      'state.loading': 'Loading learning data…',
      'state.error': 'Could not load learning data.',
      'empty.title': 'No learning data yet',
      'empty.desc': 'Accept or dismiss a suggested prompt and its stats will appear here.',
      'action.retry': 'Retry',
      'action.refresh': 'Refresh',
      'action.clear': 'Clear learning data',
      'action.clearConfirm': 'Confirm clear?',
      'action.clearing': 'Clearing…',
      'action.clearFailed': 'Could not clear learning data. Try again.',
      'time.justNow': 'just now',
      'time.minutesAgo': '{count}m ago',
      'time.hoursAgo': '{count}h ago',
      'time.daysAgo': '{count}d ago',
      'time.monthsAgo': '{count}mo ago',
      'time.yearsAgo': '{count}y ago',
    };
    /** Japanese copy. */
    const ja = {
      'key.tab': 'Tab',
      'hint': 'Tab で使用',
      'accept': '提案されたプロンプトを使用',
      'dismiss': '提案を非表示',
      'dismissReset': 'Shift+クリックで学習を消去',
      'suggestion': 'プロンプトの提案',
      'panel.label': '学習データ',
      'page.title': '学習データ',
      'page.intro': 'この記録はプロフィール内（~/.dsh/storages/prompt_suggest_learning.json）にのみ保存され、以降の提案の調整に使われます。会話の内容は含まれません。',
      'stat.rate': '採用率',
      'stat.shown': '表示回数',
      'stat.accepted': '採用回数',
      'stat.dismissed': '無視回数',
      'stat.percent': '{pct}%',
      'stat.noRate': '—',
      'section.accepted': '最近の採用',
      'section.dismissed': '最近の無視',
      'section.emptyAccepted': '採用した提案はまだありません',
      'section.emptyDismissed': '無視した提案はまだありません',
      'state.loading': '学習データを読み込み中…',
      'state.error': '学習データを読み込めませんでした。',
      'empty.title': '学習データはまだありません',
      'empty.desc': '提案を採用または無視すると、ここに統計と最近の記録が表示されます。',
      'action.retry': '再試行',
      'action.refresh': '更新',
      'action.clear': '学習データを消去',
      'action.clearConfirm': '消去しますか？',
      'action.clearing': '消去中…',
      'action.clearFailed': '消去に失敗しました。再試行してください。',
      'time.justNow': 'たった今',
      'time.minutesAgo': '{count} 分前',
      'time.hoursAgo': '{count} 時間前',
      'time.daysAgo': '{count} 日前',
      'time.monthsAgo': '{count} か月前',
      'time.yearsAgo': '{count} 年前',
    };
    /** Spanish copy. */
    const es = {
      'key.tab': 'Tab',
      'hint': 'Tab para usar',
      'accept': 'Usar el prompt sugerido',
      'dismiss': 'Ocultar sugerencia',
      'dismissReset': 'Mayús+clic para borrar el aprendizaje',
      'suggestion': 'Prompt sugerido',
      'panel.label': 'Datos de aprendizaje',
      'page.title': 'Datos de aprendizaje',
      'page.intro': 'El registro se guarda solo en tu perfil (~/.dsh/storages/prompt_suggest_learning.json) y ajusta las sugerencias posteriores. Nunca contiene el contenido de la conversación.',
      'stat.rate': 'Tasa de aceptación',
      'stat.shown': 'Mostradas',
      'stat.accepted': 'Aceptadas',
      'stat.dismissed': 'Ignoradas',
      'stat.percent': '{pct}%',
      'stat.noRate': '—',
      'section.accepted': 'Aceptadas recientemente',
      'section.dismissed': 'Ignoradas recientemente',
      'section.emptyAccepted': 'Aún no hay sugerencias aceptadas',
      'section.emptyDismissed': 'Aún no hay sugerencias ignoradas',
      'state.loading': 'Cargando datos de aprendizaje…',
      'state.error': 'No se pudieron cargar los datos de aprendizaje.',
      'empty.title': 'Aún no hay datos de aprendizaje',
      'empty.desc': 'Acepta o ignora una sugerencia y aquí aparecerán sus estadísticas.',
      'action.retry': 'Reintentar',
      'action.refresh': 'Actualizar',
      'action.clear': 'Borrar datos de aprendizaje',
      'action.clearConfirm': '¿Confirmar borrado?',
      'action.clearing': 'Borrando…',
      'action.clearFailed': 'No se pudieron borrar los datos. Inténtalo de nuevo.',
      'time.justNow': 'ahora mismo',
      'time.minutesAgo': 'hace {count} min',
      'time.hoursAgo': 'hace {count} h',
      'time.daysAgo': 'hace {count} d',
      'time.monthsAgo': 'hace {count} meses',
      'time.yearsAgo': 'hace {count} años',
    };
    /** French copy. */
    const fr = {
      'key.tab': 'Tab',
      'hint': 'Tab pour utiliser',
      'accept': 'Utiliser le prompt suggéré',
      'dismiss': 'Masquer la suggestion',
      'dismissReset': 'Maj+clic pour effacer l’apprentissage',
      'suggestion': 'Prompt suggéré',
      'panel.label': 'Données d’apprentissage',
      'page.title': 'Données d’apprentissage',
      'page.intro': 'L’enregistrement reste dans votre profil (~/.dsh/storages/prompt_suggest_learning.json) et ajuste les suggestions suivantes. Il ne contient jamais le contenu de la conversation.',
      'stat.rate': 'Taux d’acceptation',
      'stat.shown': 'Affichées',
      'stat.accepted': 'Acceptées',
      'stat.dismissed': 'Ignorées',
      'stat.percent': '{pct}%',
      'stat.noRate': '—',
      'section.accepted': 'Acceptées récemment',
      'section.dismissed': 'Ignorées récemment',
      'section.emptyAccepted': 'Aucune suggestion acceptée pour l’instant',
      'section.emptyDismissed': 'Aucune suggestion ignorée pour l’instant',
      'state.loading': 'Chargement des données d’apprentissage…',
      'state.error': 'Impossible de charger les données d’apprentissage.',
      'empty.title': 'Aucune donnée d’apprentissage pour l’instant',
      'empty.desc': 'Acceptez ou ignorez une suggestion : ses statistiques apparaîtront ici.',
      'action.retry': 'Réessayer',
      'action.refresh': 'Actualiser',
      'action.clear': 'Effacer les données d’apprentissage',
      'action.clearConfirm': 'Confirmer l’effacement ?',
      'action.clearing': 'Effacement…',
      'action.clearFailed': 'Impossible d’effacer les données. Réessayez.',
      'time.justNow': 'à l’instant',
      'time.minutesAgo': 'il y a {count} min',
      'time.hoursAgo': 'il y a {count} h',
      'time.daysAgo': 'il y a {count} j',
      'time.monthsAgo': 'il y a {count} mois',
      'time.yearsAgo': 'il y a {count} ans',
    };
    /** German copy. */
    const de = {
      'key.tab': 'Tab',
      'hint': 'Tab zum Verwenden',
      'accept': 'Vorgeschlagenen Prompt verwenden',
      'dismiss': 'Vorschlag ausblenden',
      'dismissReset': 'Umschalt+Klick zum Löschen der Lernvorgänge',
      'suggestion': 'Prompt-Vorschlag',
      'panel.label': 'Lerndaten',
      'page.title': 'Lerndaten',
      'page.intro': 'Der Datensatz liegt nur in deinem Profil (~/.dsh/storages/prompt_suggest_learning.json) und passt spätere Vorschläge an. Er enthält nie Gesprächsinhalte.',
      'stat.rate': 'Annahmerate',
      'stat.shown': 'Angezeigt',
      'stat.accepted': 'Angenommen',
      'stat.dismissed': 'Verworfen',
      'stat.percent': '{pct}%',
      'stat.noRate': '—',
      'section.accepted': 'Zuletzt angenommen',
      'section.dismissed': 'Zuletzt verworfen',
      'section.emptyAccepted': 'Noch keine angenommenen Vorschläge',
      'section.emptyDismissed': 'Noch keine verworfenen Vorschläge',
      'state.loading': 'Lerndaten werden geladen…',
      'state.error': 'Lerndaten konnten nicht geladen werden.',
      'empty.title': 'Noch keine Lerndaten',
      'empty.desc': 'Nimm einen Vorschlag an oder verwirf ihn – dann erscheinen hier Statistiken.',
      'action.retry': 'Erneut versuchen',
      'action.refresh': 'Aktualisieren',
      'action.clear': 'Lerndaten löschen',
      'action.clearConfirm': 'Löschen bestätigen?',
      'action.clearing': 'Wird gelöscht…',
      'action.clearFailed': 'Löschen fehlgeschlagen. Erneut versuchen.',
      'time.justNow': 'gerade eben',
      'time.minutesAgo': 'vor {count} Min.',
      'time.hoursAgo': 'vor {count} Std.',
      'time.daysAgo': 'vor {count} Tagen',
      'time.monthsAgo': 'vor {count} Monaten',
      'time.yearsAgo': 'vor {count} Jahren',
    };
    /** Russian copy. */
    const ru = {
      'key.tab': 'Tab',
      'hint': 'Tab — использовать',
      'accept': 'Использовать предложенный запрос',
      'dismiss': 'Скрыть подсказку',
      'dismissReset': 'Shift+щелчок — очистить обучение',
      'suggestion': 'Предложенный запрос',
      'panel.label': 'Данные обучения',
      'page.title': 'Данные обучения',
      'page.intro': 'Запись хранится только в вашем профиле (~/.dsh/storages/prompt_suggest_learning.json) и настраивает последующие подсказки. Она никогда не содержит содержимое беседы.',
      'stat.rate': 'Доля принятий',
      'stat.shown': 'Показано',
      'stat.accepted': 'Принято',
      'stat.dismissed': 'Игнорировано',
      'stat.percent': '{pct}%',
      'stat.noRate': '—',
      'section.accepted': 'Недавно принятые',
      'section.dismissed': 'Недавно игнорированные',
      'section.emptyAccepted': 'Принятых подсказок пока нет',
      'section.emptyDismissed': 'Игнорированных подсказок пока нет',
      'state.loading': 'Загрузка данных обучения…',
      'state.error': 'Не удалось загрузить данные обучения.',
      'empty.title': 'Данных обучения пока нет',
      'empty.desc': 'Примите или проигнорируйте подсказку — статистика появится здесь.',
      'action.retry': 'Повторить',
      'action.refresh': 'Обновить',
      'action.clear': 'Очистить данные обучения',
      'action.clearConfirm': 'Подтвердить очистку?',
      'action.clearing': 'Очистка…',
      'action.clearFailed': 'Не удалось очистить данные. Повторите попытку.',
      'time.justNow': 'только что',
      'time.minutesAgo': '{count} мин назад',
      'time.hoursAgo': '{count} ч назад',
      'time.daysAgo': '{count} дн. назад',
      'time.monthsAgo': '{count} мес. назад',
      'time.yearsAgo': '{count} г. назад',
    };
    /** Portuguese copy. */
    const pt = {
      'key.tab': 'Tab',
      'hint': 'Tab para usar',
      'accept': 'Usar o prompt sugerido',
      'dismiss': 'Ocultar sugestão',
      'dismissReset': 'Shift+clique para limpar o aprendizado',
      'suggestion': 'Prompt sugerido',
      'panel.label': 'Dados de aprendizado',
      'page.title': 'Dados de aprendizado',
      'page.intro': 'O registro fica apenas no seu perfil (~/.dsh/storages/prompt_suggest_learning.json) e ajusta as próximas sugestões. Ele nunca contém o conteúdo da conversa.',
      'stat.rate': 'Taxa de aceitação',
      'stat.shown': 'Exibidas',
      'stat.accepted': 'Aceitas',
      'stat.dismissed': 'Ignoradas',
      'stat.percent': '{pct}%',
      'stat.noRate': '—',
      'section.accepted': 'Aceitas recentemente',
      'section.dismissed': 'Ignoradas recentemente',
      'section.emptyAccepted': 'Ainda não há sugestões aceitas',
      'section.emptyDismissed': 'Ainda não há sugestões ignoradas',
      'state.loading': 'Carregando dados de aprendizado…',
      'state.error': 'Não foi possível carregar os dados de aprendizado.',
      'empty.title': 'Ainda não há dados de aprendizado',
      'empty.desc': 'Aceite ou ignore uma sugestão e as estatísticas aparecerão aqui.',
      'action.retry': 'Tentar novamente',
      'action.refresh': 'Atualizar',
      'action.clear': 'Limpar dados de aprendizado',
      'action.clearConfirm': 'Confirmar limpeza?',
      'action.clearing': 'Limpando…',
      'action.clearFailed': 'Não foi possível limpar os dados. Tente novamente.',
      'time.justNow': 'agora mesmo',
      'time.minutesAgo': 'há {count} min',
      'time.hoursAgo': 'há {count} h',
      'time.daysAgo': 'há {count} d',
      'time.monthsAgo': 'há {count} meses',
      'time.yearsAgo': 'há {count} anos',
    };
    const DICTIONARIES = { zh, en, ja, es, fr, de, ru, pt };
    //#endregion

    //#region styles
    /** One compact full-width row above the composer card; theme tokens only. */
    const STYLES = `
.dps-row {
  box-sizing: border-box;
  flex: none;
  width: calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));
  max-width: calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));
  margin: 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dps-accept {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: 0 0;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
@media (hover: hover) {
  .dps-accept:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dps-accept:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dps-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-label-tertiary);
}
.dps-text {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dps-key {
  flex: none;
  box-sizing: border-box;
  min-width: 22px;
  height: 18px;
  padding: 0 5px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
  text-align: center;
}
.dps-dismiss {
  box-sizing: border-box;
  flex: none;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: 0 0;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
@media (hover: hover) {
  .dps-dismiss:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-secondary);
  }
}
.dps-dismiss:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dpsl-page {
  --dpsl-inset: clamp(20px, 4vw, 48px);
  box-sizing: border-box;
  height: 100%;
  padding: 0 var(--dpsl-inset);
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
}
.dpsl-head {
  box-sizing: border-box;
  flex: none;
  width: 100%;
  max-width: 960px;
  padding-top: calc(clamp(24px, 4vw, 48px) + var(--dsh-frame-top-clearance, 0px));
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.dpsl-heading {
  min-width: 0;
  max-width: 100%;
}
.dpsl-title {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 28px;
}
.dpsl-intro {
  margin: 4px 0 0;
  max-width: 720px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dpsl-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dpsl-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: 0 0;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
@media (hover: hover) {
  .dpsl-btn:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dpsl-btn:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dpsl-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.dpsl-btnDanger {
  color: var(--dsw-alias-state-error-primary);
}
.dpsl-btnDanger:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary);
}
.dpsl-body {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 960px;
  padding: 24px 0 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow: hidden auto;
}
.dpsl-status {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.dpsl-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
  line-height: 20px;
}
.dpsl-error p {
  margin: 0;
}
.dpsl-clear-error {
  margin: 0;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.dpsl-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
@media (width <= 767px) {
  .dpsl-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.dpsl-stat {
  box-sizing: border-box;
  min-width: 0;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-module-platform);
  padding: 12px 14px;
}
.dpsl-stat-label {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dpsl-stat-value {
  margin: 4px 0 0;
  font-size: 22px;
  font-weight: 500;
  line-height: 30px;
  font-variant-numeric: tabular-nums;
}
.dpsl-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dpsl-section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.dpsl-rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}
.dpsl-row {
  box-sizing: border-box;
  display: flex;
  align-items: baseline;
  gap: 16px;
  min-width: 0;
  padding: 10px 2px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dpsl-row:last-child {
  border-bottom: 0;
}
.dpsl-row-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dpsl-row-time {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.dpsl-muted {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.dpsl-empty {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 24px;
  border: 0.5px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
}
.dpsl-empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.dpsl-empty-desc {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
`;
    /**
     * Append this plugin's stylesheet. The disposer removes only the tag it created.
     * @returns disposer owned by the plugin fiber.
     */
    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-prompt-suggest';
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = STYLES;
      const parent = document.head ?? document.documentElement;
      if (parent === null || parent === undefined) return () => {};
      parent.appendChild(tag);
      return () => {
        try {
          tag.remove();
        } catch (error) {
          /* the tag may already be detached by a document teardown */
        }
      };
    }
    //#endregion

    //#region shared accept bridge
    /**
     * Live values the document-level Tab listener reads. The mounted bar keeps this
     * object fresh on every render/effect; the listener owns one plugin-level
     * object so it never captures stale component state.
     */
    const bridge = {
      owner: null,
      visible: false,
      text: '',
      sessionId: null,
      upToSeq: null,
      seat: null,
      setDraft: null,
      hide: null,
    };

    /**
     * Clear the bridge only when `owner` still owns it (another mounted bar may have
     * replaced the content in between).
     * @param owner - instance token that currently owns the bridge.
     */
    function clearBridge(owner) {
      if (bridge.owner !== owner) return;
      bridge.owner = null;
      bridge.visible = false;
      bridge.text = '';
      bridge.sessionId = null;
      bridge.upToSeq = null;
      bridge.seat = null;
      bridge.setDraft = null;
      bridge.hide = null;
    }
    //#endregion

    //#region payload helpers
    /**
     * Read one Host response body into the bar's bounded suggestion value.
     * @param payload - parsed JSON body, trusted only structurally.
     * @returns normalized suggestion, or null when the response carries none.
     */
    function readSuggestion(payload) {
      try {
        if (payload === null || typeof payload !== 'object') return null;
        if (payload.ok === false) return null;
        const raw = payload.suggestion;
        if (raw === null || raw === undefined || typeof raw !== 'object') return null;
        if (typeof raw.text !== 'string') return null;
        const text = raw.text.replace(/\s+/gu, ' ').trim();
        if (text === '' || text.length > MAX_SUGGESTION_CHARS) return null;
        const seq = typeof raw.upToSeq === 'number' && Number.isFinite(raw.upToSeq) ? raw.upToSeq : 0;
        return { text, upToSeq: seq };
      } catch (error) {
        return null;
      }
    }

    /**
     * Whether the composer's published draft is empty and takes plain text.
     * @param state - InputState snapshot, untrusted defensively.
     * @returns whether the composer is an empty plain draft.
     */
    function readInputEmpty(state) {
      try {
        if (state === null || typeof state !== 'object') return false;
        if (state.phase !== 'plain') return false;
        const draft = typeof state.draft === 'string' ? state.draft : '';
        if (draft.trim() !== '') return false;
        const attachments = state.attachmentIds;
        if (attachments === null || attachments === undefined) return true;
        return !(typeof attachments.length === 'number' && attachments.length > 0);
      } catch (error) {
        return false;
      }
    }

    /**
     * Whether a Session snapshot describes an idle conversation with history.
     * @param snapshot - SessionSnapshot, untrusted defensively.
     * @returns whether a prediction may be shown.
     */
    function readIdle(snapshot) {
      try {
        if (snapshot === null || typeof snapshot !== 'object') return false;
        return snapshot.running !== true && snapshot.blank !== true && snapshot.awaitingFirstTurn !== true;
      } catch (error) {
        return false;
      }
    }

    /**
     * Whether a tracked Session has a pending interaction that blocks the composer.
     * @param statuses - Session status Map from SessionStatusSnapshot.
     * @param sessionId - Session to inspect.
     * @returns whether an interaction is pending.
     */
    function readInteractionPending(statuses, sessionId) {
      try {
        if (statuses === null || typeof statuses !== 'object' || typeof statuses.get !== 'function') return false;
        const status = statuses.get(sessionId);
        if (status === null || status === undefined) return false;
        return status.pendingInteraction !== null && status.pendingInteraction !== undefined;
      } catch (error) {
        return false;
      }
    }
    //#endregion

    //#region suggestion feedback
    /**
     * Fire-and-forget learning feedback. The Client keeps no learning state: the
     * Host persists the record. Each signal is one small POST that never blocks
     * render or a handler and swallows its own failure.
     */

    /** Cached keepalive-supported probe (RequestInit keepalive lets a signal outlive navigation). */
    let feedbackKeepalive;

    /** Whether this browser's fetch accepts RequestInit.keepalive. */
    function supportsFeedbackKeepalive() {
      if (feedbackKeepalive !== undefined) return feedbackKeepalive;
      try {
        if (typeof Request !== 'function') {
          feedbackKeepalive = false;
        } else {
          const probe = new Request('https://prompt-suggest.invalid/', { method: 'POST', keepalive: true });
          feedbackKeepalive = probe.keepalive === true;
        }
      } catch (error) {
        feedbackKeepalive = false;
      }
      return feedbackKeepalive;
    }

    /**
     * Send one feedback signal at the Host (best effort).
     * @param body - one `{sessionId, upToSeq, action, text?}` signal.
     */
    function sendFeedback(body) {
      try {
        if (typeof fetch !== 'function') return;
        if (body === null || typeof body !== 'object') return;
        const init = {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        };
        if (supportsFeedbackKeepalive()) init.keepalive = true;
        const result = fetch(FEEDBACK_ROUTE, init);
        if (result !== null && result !== undefined && typeof result.catch === 'function') {
          result.catch(() => {});
        }
      } catch (error) {
        /* feedback must never break or block the UI */
      }
    }
    //#endregion

    //#region glyphs
    /** 14 px sparkle marking a predicted prompt. */
    function SparkleGlyph() {
      return h(
        'svg',
        {
          className: 'dps-glyph',
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
          focusable: 'false',
          fill: 'currentColor',
        },
        h('path', { d: 'M8 1.4 9.6 5.9 14 7.5 9.6 9.1 8 13.6 6.4 9.1 2 7.5 6.4 5.9z' }),
        h('path', { d: 'M13.2 1.6 13.8 3.1 15.3 3.7 13.8 4.3 13.2 5.8 12.6 4.3 11.1 3.7 12.6 3.1z' }),
      );
    }

    /** Small dismiss cross. */
    function CloseGlyph() {
      return h(
        'svg',
        {
          width: 12,
          height: 12,
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
          focusable: 'false',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        },
        h('path', { d: 'M4.5 4.5 11.5 11.5' }),
        h('path', { d: 'M11.5 4.5 4.5 11.5' }),
      );
    }
    //#endregion

    //#region components
    /**
     * Defensive outer shell: verifies the slot seats this entry needs before any
     * Hook runs. A missing seat renders nothing instead of throwing into the slot.
     * @param props - conversation.input.dock standard properties.
     * @returns the bar or null.
     */
    function SuggestionBar(props) {
      try {
        if (props === null || typeof props !== 'object') return null;
        const { sessionId, useSession, useSessionStatus, useInput, inputActions, t } = props;
        if (typeof sessionId !== 'string' || sessionId === '') return null;
        if (typeof useSession !== 'function' || typeof useInput !== 'function') return null;
        if (typeof useSessionStatus !== 'function') return null;
        if (typeof t !== 'function') return null;
        if (inputActions === null || typeof inputActions !== 'object') return null;
        if (typeof inputActions.setDraft !== 'function') return null;
        return h(SuggestionBarInner, props);
      } catch (error) {
        return null;
      }
    }

    /**
     * The prediction row: fetches one suggestion for the idle session, publishes
     * its accept state to the Tab bridge, and renders accept/dismiss controls.
     * @param props - the verified standard slot properties.
     * @returns the bar or null.
     */
    function SuggestionBarInner(props) {
      const { sessionId, useSession, useSessionStatus, useInput, inputActions, t } = props;
      const [suggestion, setSuggestion] = React.useState(null);
      const [dismissedSeq, setDismissedSeq] = React.useState(null);
      const rootRef = React.useRef(null);
      const ownerRef = React.useRef(null);
      const generationRef = React.useRef(0);
      const shownKeyRef = React.useRef(null);
      if (ownerRef.current === null) ownerRef.current = {};

      const idle = useSession(readIdle) === true;
      const interfacePending = useSessionStatus((statuses) => readInteractionPending(statuses, sessionId)) === true;
      const inputEmpty = useInput(readInputEmpty) === true;
      const eligible = idle && inputEmpty && !interfacePending;

      // One debounced, abortable request whenever eligibility begins. Every exit
      // path aborts the controller and invalidates the response generation.
      React.useEffect(() => {
        if (!eligible) {
          setSuggestion(null);
          return undefined;
        }
        let timer = null;
        let controller = null;
        let cancelled = false;
        const generation = (generationRef.current += 1);
        const settle = (next) => {
          if (cancelled || generation !== generationRef.current) return;
          setSuggestion(next);
        };
        timer = setTimeout(() => {
          timer = null;
          if (cancelled) return;
          try {
            if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
              settle(null);
              return;
            }
            controller = new AbortController();
            fetch(SUGGEST_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId }),
              signal: controller.signal,
            })
              .then((response) => {
                if (response === null || response === undefined || response.ok !== true) return null;
                return response.json();
              })
              .then((payload) => {
                settle(readSuggestion(payload));
              })
              .catch(() => {
                settle(null);
              });
          } catch (error) {
            settle(null);
          }
        }, DEBOUNCE_MS);
        return () => {
          cancelled = true;
          generationRef.current += 1;
          if (timer !== null) clearTimeout(timer);
          if (controller !== null) {
            try {
              controller.abort();
            } catch (error) {
              /* already aborted */
            }
          }
        };
      }, [eligible, sessionId]);

      const visible = eligible && suggestion !== null && dismissedSeq !== suggestion.upToSeq;

      // Publish exactly what the Tab listener may consume; tear it down on hide.
      useLayoutEffect(() => {
        const owner = ownerRef.current;
        if (!visible || suggestion === null) {
          clearBridge(owner);
          return undefined;
        }
        const text = suggestion.text;
        const seq = suggestion.upToSeq;
        const root = rootRef.current;
        // One `shown` signal per sessionId:upToSeq (the Host dedupes too).
        const shownKey = `${sessionId}:${seq}`;
        if (shownKeyRef.current !== shownKey) {
          shownKeyRef.current = shownKey;
          sendFeedback({ sessionId, upToSeq: seq, action: 'shown' });
        }
        bridge.owner = owner;
        bridge.sessionId = sessionId;
        bridge.visible = true;
        bridge.text = text;
        bridge.upToSeq = seq;
        bridge.seat = root !== null && root !== undefined && typeof root.closest === 'function' ? root.closest(COMPOSER_SEAT_SELECTOR) : null;
        bridge.setDraft = (next) => {
          try {
            inputActions.setDraft(next);
          } catch (error) {
            /* the composer may be between sessions; the bar hides either way */
          }
        };
        bridge.hide = () => {
          try {
            setSuggestion(null);
          } catch (error) {
            /* unmounted */
          }
          try {
            setDismissedSeq(seq);
          } catch (error) {
            /* unmounted */
          }
        };
        return () => {
          clearBridge(owner);
        };
      }, [visible, suggestion, inputActions]);

      if (!visible || suggestion === null) return null;

      /** Translate a label, tolerating a missing or throwing translator. */
      const label = (key) => {
        try {
          const value = t(key);
          return typeof value === 'string' && value !== '' ? value : key;
        } catch (error) {
          return key;
        }
      };

      const accept = () => {
        try {
          const seq = suggestion.upToSeq;
          bridge.visible = false;
          try {
            setSuggestion(null);
          } catch (error) {
            /* unmounted */
          }
          try {
            setDismissedSeq(seq);
          } catch (error) {
            /* unmounted */
          }
          try {
            inputActions.setDraft(suggestion.text);
          } catch (error) {
            /* the composer may be between sessions */
          }
          sendFeedback({ sessionId, upToSeq: suggestion.upToSeq, action: 'accept', text: suggestion.text });
        } catch (error) {
          /* never throw from an event handler */
        }
      };

      /** Return focus to the composer editor after the row unmounts. */
      const focusComposer = () => {
        try {
          const root = rootRef.current;
          const seat = root !== null && root !== undefined && typeof root.closest === 'function' ? root.closest(COMPOSER_SEAT_SELECTOR) : null;
          const editor = seat !== null && seat !== undefined && typeof seat.querySelector === 'function' ? seat.querySelector(COMPOSER_INPUT_SELECTOR) : null;
          if (editor !== null && editor !== undefined && typeof editor.focus === 'function') {
            editor.focus({ preventScroll: true });
          }
        } catch (error) {
          /* focus is best effort */
        }
      };

      const dismiss = (event) => {
        try {
          const shift = event !== null && event !== undefined && event.shiftKey === true;
          const seq = suggestion.upToSeq;
          const text = suggestion.text;
          bridge.visible = false;
          focusComposer();
          // Shift+click clears the Host record and records no dismissal.
          if (shift) sendFeedback({ sessionId, upToSeq: seq, action: 'reset' });
          else sendFeedback({ sessionId, upToSeq: seq, action: 'dismiss', text });
          try {
            setSuggestion(null);
          } catch (error) {
            /* unmounted */
          }
          try {
            setDismissedSeq(seq);
          } catch (error) {
            /* unmounted */
          }
        } catch (error) {
          /* never throw from an event handler */
        }
      };

      const keepComposerFocus = (event) => {
        try {
          event.preventDefault();
        } catch (error) {
          /* synthetic event without preventDefault */
        }
      };

      return h(
        'div',
        {
          className: 'dps-row',
          ref: rootRef,
          role: 'group',
          'aria-label': label('suggestion'),
          'data-prompt-suggest': '',
        },
        h(
          'button',
          {
            type: 'button',
            className: 'dps-accept',
            tabIndex: -1,
            'aria-label': label('accept'),
            'aria-keyshortcuts': 'Tab',
            'aria-description': label('hint'),
            title: suggestion.text,
            onMouseDown: keepComposerFocus,
            onClick: accept,
          },
          h(SparkleGlyph, null),
          h('span', { className: 'dps-text' }, suggestion.text),
          h('kbd', { className: 'dps-key', 'aria-hidden': 'true' }, label('key.tab')),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dps-dismiss',
            'aria-label': label('dismiss'),
            title: label('dismissReset'),
            onMouseDown: keepComposerFocus,
            onClick: dismiss,
          },
          h(CloseGlyph, null),
        ),
      );
    }
    //#endregion

    //#region learning panel page
    /** Read the layout panel-info snapshot: whether this page is the active panel. */
    function isLearningPanelActive(info) {
      try {
        return info !== null && info !== undefined && info.activePanelId === PANEL_ID;
      } catch (error) {
        return false;
      }
    }

    /** Read the active locale id from the locale snapshot (stable selector). */
    function readActiveLocaleId(snapshot) {
      try {
        return snapshot !== null && snapshot !== undefined && typeof snapshot.active === 'string' ? snapshot.active : '';
      } catch (error) {
        return '';
      }
    }

    /** Fallback selector hooks for a shell that provides no standard seats. */
    function useNoPanelInfo(selector) {
      return false;
    }
    function useNoLocale(selector) {
      return '';
    }

    /** Coerce one learning count to a non-negative integer. */
    function readLearningNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    }

    /** Read one bounded example list from the Host's learning payload. */
    function readLearningRows(value) {
      if (!Array.isArray(value)) return [];
      const rows = [];
      for (const item of value) {
        try {
          if (rows.length >= MAX_LEARNING_ROWS) break;
          if (item === null || typeof item !== 'object' || typeof item.text !== 'string') continue;
          const text = item.text.replace(/\s+/gu, ' ').trim();
          if (text === '') continue;
          const at = typeof item.at === 'number' && Number.isFinite(item.at) && item.at > 0 ? item.at : 0;
          rows.push({ text, at });
        } catch (error) {
          /* skip one malformed row */
        }
      }
      return rows;
    }

    /**
     * Normalize one learning-data response body.
     * @param payload - parsed JSON from the Host route.
     * @returns the page model, or null when the body is unusable.
     */
    function readLearningData(payload) {
      try {
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
        if (payload.ok === false) return null;
        const counts = payload.counts !== null && typeof payload.counts === 'object' ? payload.counts : {};
        return {
          counts: {
            shown: readLearningNumber(counts.shown),
            accepted: readLearningNumber(counts.accepted),
            dismissed: readLearningNumber(counts.dismissed),
          },
          accepted: readLearningRows(payload.accepted),
          dismissed: readLearningRows(payload.dismissed),
          updatedAt: typeof payload.updatedAt === 'number' && Number.isFinite(payload.updatedAt) ? payload.updatedAt : 0,
        };
      } catch (error) {
        return null;
      }
    }

    /** Absolute timestamp for a `<time>` dateTime attribute, or undefined. */
    function safeIsoTime(at) {
      try {
        return new Date(at).toISOString();
      } catch (error) {
        return undefined;
      }
    }

    /** Absolute, locale-formatted timestamp for the row's hover title. */
    function safeAbsoluteTime(at, locale) {
      try {
        const date = new Date(at);
        return typeof locale === 'string' && locale !== '' ? date.toLocaleString(locale) : date.toLocaleString();
      } catch (error) {
        return undefined;
      }
    }

    /** Localized relative time for one stored timestamp. */
    function learningRelativeTime(at, now, t) {
      try {
        if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return '';
        const minutes = Math.floor(Math.max(0, now - at) / 60000);
        if (minutes < 1) return t('time.justNow');
        if (minutes < 60) return t('time.minutesAgo', { count: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t('time.hoursAgo', { count: hours });
        const days = Math.floor(hours / 24);
        if (days < 30) return t('time.daysAgo', { count: days });
        const months = Math.floor(days / 30);
        if (months < 12) return t('time.monthsAgo', { count: months });
        return t('time.yearsAgo', { count: Math.floor(months / 12) });
      } catch (error) {
        return '';
      }
    }

    /** Refresh glyph for the page toolbar. */
    function RefreshGlyph() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
          focusable: 'false',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { flex: 'none', display: 'block' },
        },
        h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6' }),
        h('path', { d: 'M13 2.6V5.2h-2.6' }),
      );
    }

    /**
     * Sidebar panel glyph: a small localized-neutral chart. The sidebar owns the
     * button, label, and selection; this component only paints the glyph.
     * @param props - sidebar icon share `{ size, active }`.
     * @returns the icon element.
     */
    function LearningPanelIcon(props) {
      try {
        const size = props !== null && props !== undefined && typeof props.size === 'number' && Number.isFinite(props.size) && props.size > 0 ? props.size : 18;
        const active = props !== null && props !== undefined && props.active === true;
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 16 16',
            'aria-hidden': 'true',
            focusable: 'false',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: active ? 1.7 : 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            style: { display: 'block', color: 'currentColor' },
          },
          h('path', { d: 'M2.5 13.5h11' }),
          h('path', { d: 'M4.5 13.5V9.5' }),
          h('path', { d: 'M8 13.5V5.5' }),
          h('path', { d: 'M11.5 13.5V7.5' }),
          h('path', { d: 'M4.6 6.6 6.9 4.9l2.4 1.1 2.2-2.4' }),
        );
      } catch (error) {
        return null;
      }
    }

    /** Defensive outer shell for the page: verifies the translation seat. */
    function LearningPage(props) {
      try {
        if (props === null || typeof props !== 'object') return null;
        if (typeof props.t !== 'function') return null;
        return h(LearningPageInner, props);
      } catch (error) {
        return null;
      }
    }

    /**
     * The 学习数据 page: reads the Host's learning record, renders statistics and
     * the recent accepted/dismissed suggestions, refreshes, and clears with a
     * two-step confirmation. Every request failure is contained in page state.
     * @param props - main-slot standard properties (t, usePanelInfo, useLocale).
     * @returns the page element.
     */
    function LearningPageInner(props) {
      const t = props.t;
      const usePanelInfo = typeof props.usePanelInfo === 'function' ? props.usePanelInfo : useNoPanelInfo;
      const useLocale = typeof props.useLocale === 'function' ? props.useLocale : useNoLocale;
      const panelActive = usePanelInfo(isLearningPanelActive) === true;
      const activeLocale = useLocale(readActiveLocaleId);
      const [view, setView] = React.useState({ status: 'loading', data: null });
      const [clearStage, setClearStage] = React.useState('idle');
      const [clearFailed, setClearFailed] = React.useState(false);
      const requestRef = React.useRef({ generation: 0, controller: null });
      const firstActivationRef = React.useRef(true);
      const mountedRef = React.useRef(true);

      /** Fetch the learning record; aborts any in-flight read and ignores stale responses. */
      const load = () => {
        const generation = (requestRef.current.generation += 1);
        const previous = requestRef.current.controller;
        requestRef.current.controller = null;
        if (previous !== null && typeof previous.abort === 'function') {
          try {
            previous.abort();
          } catch (error) {
            /* already aborted */
          }
        }
        setView((current) => ({ status: 'loading', data: current === null || current.data === undefined ? null : current.data }));
        try {
          if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
            setView({ status: 'error', data: null });
            return;
          }
          const controller = new AbortController();
          requestRef.current.controller = controller;
          fetch(LEARNING_ROUTE, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal })
            .then((response) => {
              if (response === null || response === undefined || response.ok !== true) return null;
              return response.json();
            })
            .then((payload) => {
              if (generation !== requestRef.current.generation) return;
              const data = readLearningData(payload);
              if (data === null) setView({ status: 'error', data: null });
              else setView({ status: 'ready', data });
            })
            .catch(() => {
              if (generation !== requestRef.current.generation) return;
              setView({ status: 'error', data: null });
            });
        } catch (error) {
          if (generation === requestRef.current.generation) setView({ status: 'error', data: null });
        }
      };

      // Mount: always read once. Unmount: abort the read and invalidate its response.
      React.useEffect(() => {
        mountedRef.current = true;
        load();
        return () => {
          mountedRef.current = false;
          requestRef.current.generation += 1;
          requestRef.current.controller = null;
        };
      }, []);
      // Becoming the active panel again refreshes (mount already covered the first activation).
      React.useEffect(() => {
        if (firstActivationRef.current) {
          firstActivationRef.current = false;
          return undefined;
        }
        if (panelActive) load();
        return undefined;
      }, [panelActive]);
      // The two-step clear confirmation cancels itself.
      React.useEffect(() => {
        if (clearStage !== 'confirm') return undefined;
        const timer = setTimeout(() => {
          setClearStage((stage) => (stage === 'confirm' ? 'idle' : stage));
        }, 4000);
        return () => clearTimeout(timer);
      }, [clearStage]);

      /** Two-step clear: first click arms, second posts `reset` and refetches. */
      const clearLearning = () => {
        try {
          if (clearStage === 'working') return;
          if (clearStage !== 'confirm') {
            setClearFailed(false);
            setClearStage('confirm');
            return;
          }
          setClearStage('working');
          setClearFailed(false);
          if (typeof fetch !== 'function') {
            setClearFailed(true);
            setClearStage('idle');
            return;
          }
          fetch(FEEDBACK_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'reset' }),
          })
            .then((response) => {
              if (response === null || response === undefined || response.ok !== true) throw new Error('reset failed');
              return undefined;
            })
            .then(() => {
              if (!mountedRef.current) return;
              setClearStage('idle');
              load();
            })
            .catch(() => {
              if (!mountedRef.current) return;
              setClearStage('idle');
              setClearFailed(true);
              load();
            });
        } catch (error) {
          setClearStage('idle');
          setClearFailed(true);
        }
      };

      /** Translate one page label with a fallback to the key. */
      const label = (key, params) => {
        try {
          const value = params === undefined ? t(key) : t(key, params);
          return typeof value === 'string' && value !== '' ? value : key;
        } catch (error) {
          return key;
        }
      };

      const data = view.data;
      const ready = view.status === 'ready' && data !== null;
      const empty = ready && data.counts.shown === 0 && data.counts.accepted === 0 && data.counts.dismissed === 0 && data.accepted.length === 0 && data.dismissed.length === 0;
      const working = clearStage === 'working';
      const now = Date.now();

      const stat = (key, value) =>
        h(
          'div',
          { className: 'dpsl-stat', key },
          h('p', { className: 'dpsl-stat-label' }, label(key)),
          h('p', { className: 'dpsl-stat-value' }, value),
        );

      const renderRows = (headingKey, rows, emptyKey, key) =>
        h(
          'section',
          { className: 'dpsl-section', key },
          h('h2', { className: 'dpsl-section-title' }, label(headingKey)),
          rows.length === 0
            ? h('p', { className: 'dpsl-muted' }, label(emptyKey))
            : h(
                'ul',
                { className: 'dpsl-rows' },
                rows.slice(0, MAX_LEARNING_ROWS).map((row, index) => {
                  const at = row.at;
                  return h(
                    'li',
                    { className: 'dpsl-row', key: `${at}:${index}` },
                    h('span', { className: 'dpsl-row-text', title: row.text }, row.text),
                    h(
                      'time',
                      {
                        className: 'dpsl-row-time',
                        dateTime: at > 0 ? safeIsoTime(at) : undefined,
                        title: at > 0 ? safeAbsoluteTime(at, activeLocale) : undefined,
                      },
                      at > 0 ? learningRelativeTime(at, now, t) : '',
                    ),
                  );
                }),
              ),
        );

      const statsRow =
        data === null
          ? null
          : h(
              'div',
              { className: 'dpsl-stats', key: 'stats' },
              stat(
                'stat.rate',
                data.counts.shown === 0 ? label('stat.noRate') : label('stat.percent', { pct: Math.round((data.counts.accepted / data.counts.shown) * 100) }),
              ),
              stat('stat.shown', String(data.counts.shown)),
              stat('stat.accepted', String(data.counts.accepted)),
              stat('stat.dismissed', String(data.counts.dismissed)),
            );

      const emptyBlock = h(
        'div',
        { className: 'dpsl-empty', key: 'empty' },
        h('p', { className: 'dpsl-empty-title' }, label('empty.title')),
        h('p', { className: 'dpsl-empty-desc' }, label('empty.desc')),
      );

      let body;
      if (view.status === 'error') {
        body = h(
          'div',
          { className: 'dpsl-error', role: 'alert', key: 'error' },
          h('p', null, label('state.error')),
          h('button', { type: 'button', className: 'dpsl-btn', onClick: load }, label('action.retry')),
        );
      } else if (data === null) {
        body = h('p', { className: 'dpsl-status', role: 'status', key: 'loading' }, label('state.loading'));
      } else {
        body = [
          statsRow,
          empty
            ? emptyBlock
            : [
                renderRows('section.accepted', data.accepted, 'section.emptyAccepted', 'accepted'),
                renderRows('section.dismissed', data.dismissed, 'section.emptyDismissed', 'dismissed'),
              ],
        ];
      }

      return h(
        'section',
        {
          className: 'dpsl-page',
          'data-prompt-suggest-learning': '',
          'aria-busy': view.status === 'loading' || working,
        },
        h(
          'header',
          { className: 'dpsl-head', 'data-window-drag': true },
          h(
            'div',
            { className: 'dpsl-heading' },
            h('h1', { className: 'dpsl-title' }, label('page.title')),
            h('p', { className: 'dpsl-intro' }, label('page.intro')),
          ),
          h(
            'div',
            { className: 'dpsl-toolbar' },
            h(
              'button',
              {
                type: 'button',
                className: 'dpsl-btn',
                onClick: load,
                disabled: view.status === 'loading',
                'aria-label': label('action.refresh'),
              },
              h(RefreshGlyph, null),
              h('span', null, label('action.refresh')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dpsl-btn dpsl-btnDanger',
                onClick: clearLearning,
                disabled: working || data === null || empty,
                title: label('action.clear'),
              },
              label(clearStage === 'confirm' ? 'action.clearConfirm' : working ? 'action.clearing' : 'action.clear'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dpsl-body' },
          clearFailed ? h('p', { className: 'dpsl-clear-error', role: 'alert' }, label('action.clearFailed')) : null,
          body,
        ),
      );
    }
    //#endregion

    //#region tab acceptance
    /**
     * Install the document capture-phase Tab listener. It reads only fresh bridge
     * values, so a stale render can never consume a Tab it no longer owns.
     * @returns disposer removing the listener.
     */
    function installTabAccept() {
      if (typeof document === 'undefined') return () => {};
      const onKeyDown = (event) => {
        try {
          if (bridge.visible !== true) return;
          if (event === null || event === undefined) return;
          if (event.key !== 'Tab') return;
          if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
          if (event.repeat === true || event.isComposing === true || event.keyCode === 229) return;
          const text = bridge.text;
          if (typeof text !== 'string' || text === '') return;
          const eventTarget = event.target;
          if (eventTarget === null || eventTarget === undefined) return;
          if (typeof Element === 'undefined' || !(eventTarget instanceof Element)) return;
          const editor = eventTarget.closest(COMPOSER_INPUT_SELECTOR);
          if (editor === null || editor === undefined) return;
          const seat = bridge.seat;
          if (seat !== null && seat !== undefined) {
            if (typeof seat.contains !== 'function' || !seat.contains(editor)) return;
          }
          event.preventDefault();
          event.stopPropagation();
          bridge.visible = false;
          const setDraft = bridge.setDraft;
          const hide = bridge.hide;
          if (typeof setDraft === 'function') {
            try {
              setDraft(text);
            } catch (error) {
              /* never break the editor */
            }
          }
          sendFeedback({ sessionId: bridge.sessionId, upToSeq: bridge.upToSeq, action: 'accept', text });
          if (typeof hide === 'function') {
            try {
              hide();
            } catch (error) {
              /* never break the editor */
            }
          }
        } catch (error) {
          /* a keydown listener must never throw into the page */
        }
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => {
        document.removeEventListener('keydown', onKeyDown, true);
      };
    }
    //#endregion

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, DICTIONARIES);
          } catch (error) {
            return () => {};
          }
        }, 'prompt-suggest: dictionaries');
        ctx.effect(() => installStyles(), 'prompt-suggest: styles');
        ctx.effect(() => installTabAccept(), 'prompt-suggest: tab acceptance');
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'prompt-suggest',
              order: 30,
              locale: NS,
            },
            SuggestionBar,
          ),
        );
        // Learning page chrome: the sidebar entry selects the main panel below.
        const boundT = ctx.locale.bind(NS);
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ hooks: { locale: ctx.locale } }),
            },
            LearningPage,
          ),
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => {
                try {
                  return boundT('panel.label');
                } catch (error) {
                  return PANEL_ID;
                }
              },
              locale: NS,
            },
            LearningPanelIcon,
          ),
        );
      },
    };
  },
});
