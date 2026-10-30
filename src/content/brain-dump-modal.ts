/**
 * @module content/brain-dump-modal
 *
 * WHY:  Phase 9 ADHD-21..22 — users press a keyboard shortcut and expect an
 *       immediate capture surface on whatever page they're on, without
 *       context-switching to the sidepanel or a popup. A content-script
 *       modal injected at shortcut-fire time IS that capture surface.
 *       Because the script runs inside the host page's document and the
 *       host's CSS cannot be trusted, every style is INLINE — no Tailwind
 *       classes, no global stylesheet.
 *
 * WHAT: An IIFE that:
 *       1. Idempotency-guards on window.__bluetabBrainDumpModalOpen so
 *          repeated shortcut presses don't stack modals.
 *       2. Queries the service worker for BrainDumpPrefs to seed the
 *          attach/detach chip state (remembered-last-choice — ADHD-22).
 *       3. Renders a centered modal with backdrop, autofocused textarea,
 *          detachable tab-context chip (active tab title + URL + favicon),
 *          and footer hint "Enter to save · Esc to cancel".
 *       4. Enter (without shift) → posts {action:'brain-dump:save', text,
 *          tabContext?} to the SW and closes on success. Also posts
 *          {action:'brain-dump:set-prefs', tabContextDefault} to record
 *          the attach choice.
 *       5. Shift+Enter inserts a newline (native textarea behavior).
 *       6. Esc → close without saving.
 *       7. Backdrop click → close without saving.
 *
 * HOW:  - All DOM is built via document.createElement; no template strings
 *         with innerHTML to avoid any CSP concerns on strict host pages.
 *       - Event listeners use capture phase for Escape so host-page
 *         listeners can't swallow the key.
 *       - Tab-context captured from document.title / location.href /
 *         <link rel~=icon> at modal-mount time — the SW already validated
 *         this tab is not a restricted URL before injection.
 *
 * NOT:  Does not read/write chrome.storage directly — all persistence flows
 *         through the SW via chrome.runtime.sendMessage. Keeps the content
 *         script stateless across injections.
 *       Does not use crypto.randomUUID for the entry id — the SW handles
 *         id generation in BrainDumpService.add so ids are consistent.
 *       Does not touch any Tailwind class or the host page's stylesheet.
 */

import { getLanguageDirection, initI18n, t as translate } from '@/i18n';

(async () => {
  const resolvedLanguage = await initI18n({ manageDocumentMetadata: false });
  const MOUNT_FLAG = '__bluetabBrainDumpModalOpen';
  const win = window as typeof window & { [MOUNT_FLAG]?: boolean };

  if (win[MOUNT_FLAG]) {
    // Already mounted — a second shortcut press is a no-op. The open modal
    // stays focused so the user's keystroke isn't lost.
    return;
  }
  win[MOUNT_FLAG] = true;

  // --- Capture tab context ------------------------------------------------

  function findFaviconHref(): string | undefined {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel~="icon"], link[rel="shortcut icon"]',
    );
    return link?.href || undefined;
  }

  const tabContext = {
    url: location.href,
    title: document.title || location.href,
    favicon: findFaviconHref(),
  };

  // Runtime state — mutated by UI interactions, read at save time.
  let attached = true; // Seeded below via getPrefs handshake.
  let canSummarizePageToDump = false;
  let summarizePending = false;
  // Plan 14-07 (INTEG-11) — destination override. Default null = save to
  // Bluetab inbox only. When non-null, the SW also routes the entry to
  // the chosen integration via integrationService.dispatchVerb.
  let destinationOverride: { integrationId: string; accountId: string; target?: string | null } | null = null;
  let unavailableDestinationMessage: string | null = null;
  // Calendar-specific: user-chosen start time and duration.
  function tomorrowSameTime(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  let calendarStartIso = tomorrowSameTime();
  let calendarDurationMinutes = 30;

  // --- DOM ----------------------------------------------------------------

  const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;

  const backdrop = document.createElement('div');
  backdrop.setAttribute('data-bluetab-brain-dump', 'backdrop');
  backdrop.lang = resolvedLanguage;
  backdrop.dir = getLanguageDirection(resolvedLanguage);
  Object.assign(backdrop.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    width: '100vw',
    height: '100vh',
    background: 'rgba(0, 0, 0, 0.60)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    zIndex: '2147483646',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  } as Partial<CSSStyleDeclaration>);

  const card = document.createElement('div');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', translate('brainDumpModal.title'));
  Object.assign(card.style, {
    width: 'min(520px, calc(100vw - 40px))',
    maxHeight: 'calc(90vh)',
    padding: '24px',
    background: isDark ? 'hsla(220, 14%, 10%, 0.7)' : 'hsla(220, 15%, 97%, 0.75)',
    color: isDark ? 'hsl(220, 10%, 85%)' : 'hsl(220, 15%, 10%)',
    borderRadius: '12px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    border: isDark ? '1px solid hsla(220, 15%, 50%, 0.12)' : '1px solid hsla(220, 15%, 20%, 0.15)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    zIndex: '2147483647',
  } as Partial<CSSStyleDeclaration>);

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = translate('brainDumpModal.title');
  Object.assign(title.style, {
    fontSize: '15px',
    fontWeight: '600',
    letterSpacing: '-0.01em',
  } as Partial<CSSStyleDeclaration>);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', translate('brainDumpModal.close'));
  closeBtn.textContent = '\u00D7'; // multiplication sign
  Object.assign(closeBtn.style, {
    appearance: 'none',
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    fontSize: '20px',
    lineHeight: '1',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '8px',
    opacity: '0.7',
  } as Partial<CSSStyleDeclaration>);

  header.appendChild(title);
  header.appendChild(closeBtn);

  const borderColor = isDark ? 'hsla(220, 12%, 20%, 1)' : 'hsla(220, 12%, 88%, 1)';
  const inputBg = isDark ? 'hsla(220, 14%, 10%, 0.6)' : 'hsla(220, 15%, 99%, 0.6)';
  const mutedText = isDark ? 'hsl(220, 10%, 48%)' : 'hsl(220, 8%, 50%)';

  // Textarea
  const textarea = document.createElement('textarea');
  textarea.dir = 'auto';
  textarea.placeholder = translate('brainDumpModal.textareaPlaceholder');
  textarea.setAttribute('aria-label', translate('brainDumpModal.textareaAria'));
  Object.assign(textarea.style, {
    width: '100%',
    minHeight: '120px',
    maxHeight: '50vh',
    padding: '12px',
    borderRadius: '8px',
    border: `1px solid ${borderColor}`,
    background: inputBg,
    color: 'inherit',
    fontSize: '14px',
    lineHeight: '1.5',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  } as Partial<CSSStyleDeclaration>);

  const summarizeBtn = document.createElement('button');
  summarizeBtn.type = 'button';
  summarizeBtn.textContent = translate('brainDumpModal.summarize');
  Object.assign(summarizeBtn.style, {
    appearance: 'none',
    border: `1px solid ${borderColor}`,
    borderRadius: '9999px',
    background: inputBg,
    color: 'inherit',
    cursor: 'pointer',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: '500',
    display: 'none',
    alignSelf: 'flex-end',
  } as Partial<CSSStyleDeclaration>);

  // Tab-context chip
  const chip = document.createElement('div');
  chip.setAttribute('data-bluetab-brain-dump', 'chip');
  Object.assign(chip.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderRadius: '9999px',
    border: `1px solid ${borderColor}`,
    fontSize: '12px',
    color: 'inherit',
    maxWidth: '100%',
  } as Partial<CSSStyleDeclaration>);

  const chipIcon = document.createElement('img');
  if (tabContext.favicon) chipIcon.src = tabContext.favicon;
  chipIcon.alt = '';
  Object.assign(chipIcon.style, {
    width: '14px',
    height: '14px',
    flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  chipIcon.addEventListener('error', () => {
    chipIcon.style.display = 'none';
  });

  const chipLabel = document.createElement('span');
  chipLabel.dir = 'auto';
  chipLabel.textContent = tabContext.title;
  chipLabel.title = tabContext.url;
  Object.assign(chipLabel.style, {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '320px',
  } as Partial<CSSStyleDeclaration>);

  const chipDetach = document.createElement('button');
  chipDetach.type = 'button';
  chipDetach.textContent = '\u00D7';
  chipDetach.setAttribute('aria-label', translate('brainDumpModal.detachActiveTab'));
  Object.assign(chipDetach.style, {
    appearance: 'none',
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    padding: '0 2px',
    fontSize: '14px',
    opacity: '0.7',
    lineHeight: '1',
  } as Partial<CSSStyleDeclaration>);

  const chipRestore = document.createElement('button');
  chipRestore.type = 'button';
  chipRestore.textContent = translate('brainDumpModal.attachActiveTab');
  Object.assign(chipRestore.style, {
    appearance: 'none',
    background: 'transparent',
    border: `1px dashed ${borderColor}`,
    color: 'inherit',
    cursor: 'pointer',
    padding: '6px 10px',
    fontSize: '12px',
    borderRadius: '9999px',
    display: 'none', // hidden until detached
  } as Partial<CSSStyleDeclaration>);

  chip.appendChild(chipIcon);
  chip.appendChild(chipLabel);
  chip.appendChild(chipDetach);

  // Error strip (hidden until needed)
  const errorStrip = document.createElement('div');
  errorStrip.dir = 'auto';
  errorStrip.setAttribute('role', 'alert');
  Object.assign(errorStrip.style, {
    display: 'none',
    padding: '8px 10px',
    borderRadius: '8px',
    background: 'rgba(239, 68, 68, 0.15)',
    color: '#b91c1c',
    fontSize: '12px',
  } as Partial<CSSStyleDeclaration>);

  // Footer hint
  const hint = document.createElement('div');
  hint.textContent = translate('brainDumpModal.hint');
  Object.assign(hint.style, {
    fontSize: '11px',
    color: mutedText,
  } as Partial<CSSStyleDeclaration>);

  const footerRow = document.createElement('div');
  Object.assign(footerRow.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    width: '100%',
  } as Partial<CSSStyleDeclaration>);
  footerRow.appendChild(hint);
  footerRow.appendChild(summarizeBtn);

  // Plan 14-07 — destination picker (INTEG-11). Hidden until the SW
  // returns at least one connected integration; default selection
  // "Bluetab inbox" (value="").
  const destWrap = document.createElement('div');
  Object.assign(destWrap.style, {
    display: 'none', // shown only if there are connected integrations
    flexDirection: 'column',
    gap: '4px',
    fontSize: '12px',
  } as Partial<CSSStyleDeclaration>);

  const destLabel = document.createElement('label');
  destLabel.textContent = translate('brainDumpModal.saveTo');
  destLabel.setAttribute('for', 'bluetab-brain-dump-dest');
  Object.assign(destLabel.style, {
    fontWeight: '500',
    color: mutedText,
  } as Partial<CSSStyleDeclaration>);

  const destSelect = document.createElement('select');
  destSelect.dir = 'auto';
  destSelect.id = 'bluetab-brain-dump-dest';
  destSelect.setAttribute('aria-label', translate('brainDumpModal.saveDestination'));
  Object.assign(destSelect.style, {
    appearance: 'auto',
    border: `1px solid ${borderColor}`,
    borderRadius: '8px',
    padding: '6px 10px',
    background: inputBg,
    color: 'inherit',
    fontSize: '12px',
    fontFamily: 'inherit',
    width: '100%',
  } as Partial<CSSStyleDeclaration>);

  const inboxOption = document.createElement('option');
  inboxOption.value = '';
  inboxOption.textContent = translate('brainDumpModal.inbox');
  destSelect.appendChild(inboxOption);

  destSelect.addEventListener('change', () => {
    const v = destSelect.value;
    unavailableDestinationMessage = null;
    if (!v) {
      destinationOverride = null;
    } else {
      const parts = v.split(':');
      const integrationId = parts[0];
      const accountId = parts[1];
      const target = parts.length > 2 ? parts.slice(2).join(':') : null;
      destinationOverride = { integrationId, accountId, target };
    }
    // Show/hide calendar timing section based on destination.
    const isCal = destinationOverride?.integrationId === 'google-calendar'
      || destinationOverride?.integrationId === 'outlook-calendar';
    calTimingWrap.style.display = isCal ? 'flex' : 'none';
  });

  destWrap.appendChild(destLabel);
  destWrap.appendChild(destSelect);

  // Calendar timing section — shown when destination is a calendar integration.
  const calTimingWrap = document.createElement('div');
  Object.assign(calTimingWrap.style, {
    display: 'none',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1px solid ${borderColor}`,
    background: inputBg,
    fontSize: '12px',
  } as Partial<CSSStyleDeclaration>);

  const calTimingTitle = document.createElement('div');
  calTimingTitle.textContent = translate('brainDumpModal.eventTiming');
  Object.assign(calTimingTitle.style, {
    fontWeight: '500',
    fontSize: '12px',
  } as Partial<CSSStyleDeclaration>);

  const calRow = document.createElement('div');
  Object.assign(calRow.style, {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end',
  } as Partial<CSSStyleDeclaration>);

  // Start datetime input
  const calStartWrap = document.createElement('div');
  Object.assign(calStartWrap.style, { flex: '1', display: 'flex', flexDirection: 'column', gap: '3px' } as Partial<CSSStyleDeclaration>);
  const calStartLabel = document.createElement('label');
  calStartLabel.textContent = translate('brainDumpModal.start');
  calStartLabel.setAttribute('for', 'bluetab-cal-start');
  Object.assign(calStartLabel.style, { fontSize: '11px', color: mutedText } as Partial<CSSStyleDeclaration>);
  const calStartInput = document.createElement('input');
  calStartInput.type = 'datetime-local';
  calStartInput.dir = 'ltr';
  calStartInput.id = 'bluetab-cal-start';
  Object.assign(calStartInput.style, {
    width: '100%',
    height: '30px',
    border: `1px solid ${borderColor}`,
    borderRadius: '6px',
    background: inputBg,
    color: 'inherit',
    fontSize: '12px',
    padding: '4px 8px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
    colorScheme: isDark ? 'dark' : 'light',
  } as Partial<CSSStyleDeclaration>);
  calStartInput.value = calendarStartIso;
  calStartInput.addEventListener('change', () => {
    calendarStartIso = calStartInput.value;
  });
  calStartWrap.appendChild(calStartLabel);
  calStartWrap.appendChild(calStartInput);

  // Duration select
  const calDurWrap = document.createElement('div');
  Object.assign(calDurWrap.style, { width: '90px', display: 'flex', flexDirection: 'column', gap: '3px' } as Partial<CSSStyleDeclaration>);
  const calDurLabel = document.createElement('label');
  calDurLabel.textContent = translate('brainDumpModal.duration');
  calDurLabel.setAttribute('for', 'bluetab-cal-dur');
  Object.assign(calDurLabel.style, { fontSize: '11px', color: mutedText } as Partial<CSSStyleDeclaration>);
  const calDurSelect = document.createElement('select');
  calDurSelect.id = 'bluetab-cal-dur';
  Object.assign(calDurSelect.style, {
    width: '100%',
    height: '30px',
    border: `1px solid ${borderColor}`,
    borderRadius: '6px',
    background: inputBg,
    color: 'inherit',
    fontSize: '12px',
    padding: '4px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
    appearance: 'auto',
  } as Partial<CSSStyleDeclaration>);
  for (const [val, label] of [
    ['15', translate('brainDumpModal.duration15m')],
    ['30', translate('brainDumpModal.duration30m')],
    ['45', translate('brainDumpModal.duration45m')],
    ['60', translate('brainDumpModal.duration1h')],
    ['90', translate('brainDumpModal.duration1_5h')],
    ['120', translate('brainDumpModal.duration2h')],
  ]) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === '30') opt.selected = true;
    calDurSelect.appendChild(opt);
  }
  calDurSelect.addEventListener('change', () => {
    calendarDurationMinutes = parseInt(calDurSelect.value, 10);
  });
  calDurWrap.appendChild(calDurLabel);
  calDurWrap.appendChild(calDurSelect);

  calRow.appendChild(calStartWrap);
  calRow.appendChild(calDurWrap);

  calTimingWrap.appendChild(calTimingTitle);
  calTimingWrap.appendChild(calRow);

  // Assemble
  card.appendChild(header);
  card.appendChild(destWrap);
  card.appendChild(calTimingWrap);
  card.appendChild(textarea);
  card.appendChild(chip);
  card.appendChild(chipRestore);
  card.appendChild(errorStrip);
  card.appendChild(footerRow);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  // --- Behavior -----------------------------------------------------------

  function close(): void {
    win[MOUNT_FLAG] = false;
    document.removeEventListener('keydown', onKeyDownCapture, true);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  function showError(msg: string): void {
    errorStrip.textContent = msg;
    errorStrip.style.display = 'block';
  }

  function clearError(): void {
    errorStrip.style.display = 'none';
    errorStrip.textContent = '';
  }

  function updateSummarizeVisibility(): void {
    const shouldShow = canSummarizePageToDump && textarea.value.trim().length === 0;
    summarizeBtn.style.display = shouldShow ? 'inline-flex' : 'none';
  }

  function setSummarizePending(next: boolean): void {
    summarizePending = next;
    summarizeBtn.textContent = next
      ? translate('brainDumpModal.summarizing')
      : translate('brainDumpModal.summarize');
    summarizeBtn.style.opacity = next ? '0.7' : '1';
    summarizeBtn.style.pointerEvents = next ? 'none' : 'auto';
  }

  function setAttached(next: boolean): void {
    attached = next;
    if (next) {
      chip.style.display = 'flex';
      chipRestore.style.display = 'none';
    } else {
      chip.style.display = 'none';
      chipRestore.style.display = 'inline-flex';
    }
  }

  chipDetach.addEventListener('click', () => setAttached(false));
  chipRestore.addEventListener('click', () => setAttached(true));
  closeBtn.addEventListener('click', close);

  backdrop.addEventListener('mousedown', (ev) => {
    // Only close when the user clicks directly on the backdrop, not on the card.
    if (ev.target === backdrop) close();
  });

  function save(): void {
    clearError();
    const text = textarea.value.trim();
    if (text.length === 0) {
      showError(translate('brainDumpModal.emptyError'));
      return;
    }
    if (unavailableDestinationMessage) {
      showError(unavailableDestinationMessage);
      return;
    }

    const payload: Record<string, unknown> = {
      action: 'brain-dump:save' as const,
      text,
      tabContext: attached ? tabContext : undefined,
      // Plan 14-07 — INTEG-11. SW handles routing if non-null.
      destinationOverride,
    };
    // Calendar-specific: pass user-chosen start time and duration.
    const isCal = destinationOverride?.integrationId === 'google-calendar'
      || destinationOverride?.integrationId === 'outlook-calendar';
    if (isCal) {
      payload.calendarStartIso = calendarStartIso;
      payload.calendarDurationMinutes = calendarDurationMinutes;
    }

    try {
      chrome.runtime.sendMessage(payload, (response?: { success: boolean; error?: string }) => {
        if (chrome.runtime.lastError) {
          showError(translate('brainDumpModal.reachError'));
          return;
        }
        if (!response || !response.success) {
          showError(response?.error ?? translate('brainDumpModal.saveError'));
          return;
        }
        // Persist the attach choice (remembers-last-choice). Fire-and-forget.
        try {
          chrome.runtime.sendMessage({
            action: 'brain-dump:set-prefs',
            tabContextDefault: attached,
          });
        } catch {
          // Ignore — prefs write is non-critical for the current entry.
        }
        close();
      });
    } catch (err) {
      showError(translate('brainDumpModal.reachError'));
      console.debug('[BlueTab][BrainDumpModal] sendMessage threw', err);
    }
  }

  textarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      save();
    }
  });
  textarea.addEventListener('input', updateSummarizeVisibility);

  summarizeBtn.addEventListener('click', () => {
    if (summarizePending || textarea.value.trim().length > 0) return;
    clearError();
    if (unavailableDestinationMessage) {
      showError(unavailableDestinationMessage);
      return;
    }
    setSummarizePending(true);

    const payload: Record<string, unknown> = {
      action: 'brain-dump:summarize-page',
      url: tabContext.url,
      title: tabContext.title,
      html: document.documentElement?.outerHTML ?? '',
      tabContext,
      destinationOverride,
    };

    const isCal = destinationOverride?.integrationId === 'google-calendar'
      || destinationOverride?.integrationId === 'outlook-calendar';
    if (isCal) {
      payload.calendarStartIso = calendarStartIso;
      payload.calendarDurationMinutes = calendarDurationMinutes;
    }

    try {
      chrome.runtime.sendMessage(payload, (response?: { success: boolean; error?: string }) => {
        setSummarizePending(false);
        if (chrome.runtime.lastError) {
          showError(translate('brainDumpModal.reachError'));
          return;
        }
        if (!response?.success) {
          showError(response?.error ?? translate('brainDumpModal.saveError'));
          return;
        }
        close();
      });
    } catch (err) {
      setSummarizePending(false);
      showError(translate('brainDumpModal.reachError'));
      console.debug('[BlueTab][BrainDumpModal] summarize sendMessage threw', err);
    }
  });

  // Escape at capture phase — guards against host pages that swallow key events.
  function onKeyDownCapture(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  }
  document.addEventListener('keydown', onKeyDownCapture, true);

  // Seed the attach state from remembered prefs. Fire-and-forget with a
  // sensible default (attached=true) if the SW is cold / unreachable.
  try {
    chrome.runtime.sendMessage(
      { action: 'brain-dump:get-prefs' },
      (response?: { prefs?: { tabContextDefault?: boolean }; canSummarizePageToDump?: boolean }) => {
        if (chrome.runtime.lastError) return;
        const next = response?.prefs?.tabContextDefault;
        if (typeof next === 'boolean') setAttached(next);
        canSummarizePageToDump = response?.canSummarizePageToDump === true;
        updateSummarizeVisibility();
      },
    );
  } catch {
    // Content script isolated from SW at the moment — keep the default.
  }

  // Plan 14-07 — fetch connected integrations to populate the destination
  // dropdown. Hide the dropdown when the user has no integrations.
  try {
    chrome.runtime.sendMessage(
      { action: 'brain-dump:get-integrations' },
      (response?: {
        destinations?: Array<{
          key: string;
          integrationId: string;
          accountId: string;
          accountLabel: string;
          target: string | null;
          label: string;
        }>;
        destinationOverride?: { integrationId: string; accountId: string; target?: string | null } | null;
        unavailableDestinationMessage?: string | null;
      }) => {
        if (chrome.runtime.lastError) return;
        const list = response?.destinations ?? [];
        const saved = response?.destinationOverride;
        const unavailableMessage = saved
          ? response?.unavailableDestinationMessage ?? null
          : null;
        if (list.length === 0 && !unavailableMessage) {
          destWrap.style.display = 'none';
          return;
        }
        for (const d of list) {
          const opt = document.createElement('option');
          opt.dir = 'auto';
          opt.value = d.key;
          opt.textContent = d.label;
          destSelect.appendChild(opt);
        }
        // Apply remembered destination, if any.
        if (saved) {
          const savedKey = saved.target
            ? `${saved.integrationId}:${saved.accountId}:${saved.target}`
            : `${saved.integrationId}:${saved.accountId}`;
          if (unavailableMessage) {
            const unavailableOption = document.createElement('option');
            unavailableOption.dir = 'auto';
            unavailableOption.value = savedKey;
            unavailableOption.textContent = unavailableMessage;
            unavailableOption.disabled = true;
            destSelect.appendChild(unavailableOption);
            destSelect.value = savedKey;
            destinationOverride = saved;
            unavailableDestinationMessage = unavailableMessage;
            showError(unavailableMessage);
          } else if (Array.from(destSelect.options).some((o) => o.value === savedKey)) {
            destSelect.value = savedKey;
            destinationOverride = saved;
            // Programmatic value set doesn't fire 'change' — sync calTimingWrap manually.
            const isCal = saved.integrationId === 'google-calendar' || saved.integrationId === 'outlook-calendar';
            calTimingWrap.style.display = isCal ? 'flex' : 'none';
          }
        }
        destWrap.style.display = 'flex';
        updateSummarizeVisibility();
      },
    );
  } catch {
    // Non-critical — leave dropdown hidden.
  }

  // Initial focus — the whole point of the shortcut is that the user can
  // start typing immediately.
  updateSummarizeVisibility();
  requestAnimationFrame(() => textarea.focus());
})();
