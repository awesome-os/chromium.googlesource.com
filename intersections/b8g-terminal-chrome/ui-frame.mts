/**
 * B8G Terminal Chrome — Real Browser UI Frame (Chrome Layer).
 *
 * Layers a crisp Unicode box-drawing browser frame around the live Chromium
 * viewport:
 *   Row 0: Tab strip + Shell badge + FPS/latency telemetry
 *   Row 1: Navigation buttons ([◀] [▶] [↻]) + Interactive Omnibox (URL bar)
 *   Row 2: Viewport top divider
 *   Rows 3..H-2: Viewport content flanked by `│ ... │` frame rails
 *   Row H-1: Bottom status & hotkey bar
 */

export interface BrowserUiFrameState {
  cols: number;
  rows: number;
  title: string;
  url: string;
  modeLabel: string;
  frameCount: number;
  captureMs: string;
  /** When true, Omnibox is focused and displays `omniboxBuffer` with a live block cursor. */
  omniboxFocused: boolean;
  omniboxBuffer: string;
  /** Optional warning banner (e.g. non-Kitty terminal warning). */
  warning?: string;
}

/** Number of terminal rows reserved by the UI chrome (3 top + 1 bottom). */
export const UI_CHROME_TOP_ROWS = 3;
export const UI_CHROME_BOTTOM_ROWS = 1;
export const UI_CHROME_SIDE_COLS = 2; // left `│` + right `│`

const BG_BAR = '\x1b[48;2;20;24;34m';
const BG_TAB_ACTIVE = '\x1b[48;2;36;48;68m';
const BG_OMNI = '\x1b[48;2;12;15;22m';
const BG_OMNI_FOCUS = '\x1b[48;2;24;42;72m';
const FG_BORDER = '\x1b[38;2;86;112;148m';
const FG_ACCENT = '\x1b[38;2;110;215;255m';
const FG_GREEN = '\x1b[38;2;115;245;175m';
const FG_WARN = '\x1b[38;2;255;195;80m';
const FG_TEXT = '\x1b[38;2;226;232;240m';
const FG_DIM = '\x1b[38;2;130;148;172m';
const RESET = '\x1b[0m';

function fit(s: string, width: number): string {
  if (width <= 0) return '';
  if (s.length <= width) return s.padEnd(width, ' ');
  if (width <= 3) return s.slice(0, width);
  return s.slice(0, width - 1) + '…';
}

export function renderTopChrome(state: BrowserUiFrameState): string[] {
  const cols = Math.max(40, Math.floor(state.cols));
  const inner = cols - 2;

  // Row 0: Tab strip
  const cleanTitle = (state.title || 'New Tab').replace(/[\r\n\t]+/g, ' ').trim();
  const badge = ` [${state.modeLabel}] `;
  const brand = ' ● B8G-CHROME ';
  const tabMax = Math.max(10, inner - brand.length - badge.length - 7);
  const tabLabel = ` 1: ${fit(cleanTitle, tabMax).trimEnd()} `;
  const used0 = brand.length + tabLabel.length + badge.length + 3;
  const fill0 = '─'.repeat(Math.max(0, inner - used0));

  const row0 =
    `${BG_BAR}${FG_BORDER}╭─${FG_ACCENT}${brand}` +
    `${BG_TAB_ACTIVE}${FG_TEXT}${tabLabel}` +
    `${BG_BAR}${FG_BORDER}${fill0}${FG_GREEN}${badge}─╮${RESET}`;

  // Row 1: Navigation + Interactive Omnibox
  const nav = ' ◀  ▶  ↻ ';
  const protoIcon = state.url.startsWith('https://')
    ? '🔒 '
    : state.url.startsWith('file://')
      ? '📁 '
      : '🌐 ';
  const hint = state.omniboxFocused ? ' [Enter:Go Esc:Cancel] ' : ' [g:URL] ';
  const omniWidth = Math.max(12, inner - nav.length - hint.length - 2);
  const rawOmniText = state.omniboxFocused
    ? `${state.omniboxBuffer}█`
    : `${protoIcon}${state.url}`;
  const omniText = fit(rawOmniText, omniWidth);
  const omniBg = state.omniboxFocused ? BG_OMNI_FOCUS : BG_OMNI;
  const omniFg = state.omniboxFocused ? FG_ACCENT : FG_TEXT;

  const row1 =
    `${BG_BAR}${FG_BORDER}│${FG_DIM}${nav}│` +
    `${omniBg}${omniFg} ${omniText}` +
    `${BG_BAR}${FG_DIM}${hint}${FG_BORDER}│${RESET}`;

  // Row 2: Divider
  const row2 = `${BG_BAR}${FG_BORDER}├${'─'.repeat(inner)}┤${RESET}`;

  return [row0, row1, row2];
}

export function renderBottomChrome(state: BrowserUiFrameState): string {
  const cols = Math.max(40, Math.floor(state.cols));
  const inner = cols - 2;

  const left = ` #${state.frameCount} ${state.captureMs}ms `;
  const right = state.warning
    ? ` ${state.warning} `
    : ' [g]URL [b/f]Nav [r]Reload [j/k]Scroll [c]Mode [m]Kitty [q]Quit ';
  const maxRight = Math.max(8, inner - left.length - 2);
  const clippedRight = fit(right, maxRight).trimEnd();
  const fill = '─'.repeat(Math.max(0, inner - left.length - clippedRight.length - 1));

  return (
    `${BG_BAR}${FG_BORDER}╰─${FG_GREEN}${left}${FG_BORDER}${fill}` +
    `${state.warning ? FG_WARN : FG_DIM}${clippedRight}${FG_BORDER}╯${RESET}`
  );
}

/**
 * Wraps an already-rendered ANSI viewport string (whose lines have width = cols - 2)
 * inside the full B8G Browser Chrome frame.
 */
export function wrapViewportWithUiFrame(
  viewportBody: string,
  state: BrowserUiFrameState,
  liveFrame: boolean,
): string {
  const top = renderTopChrome(state);
  const bottom = renderBottomChrome(state);
  const bodyLines = viewportBody.split('\n');
  const railL = `${BG_BAR}${FG_BORDER}│${RESET}`;
  const railR = `${BG_BAR}${FG_BORDER}│${RESET}`;

  const framedLines = [
    ...top,
    ...bodyLines.map((line) => `${railL}${line}${railR}`),
    bottom,
  ];

  const joined = framedLines.join('\n');
  return liveFrame ? `\x1b[?2026h\x1b[H${joined}\x1b[?2026l` : joined;
}
