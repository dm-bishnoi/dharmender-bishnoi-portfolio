/**
 * Laptop screen content — VS Code–style editor drawn to an offscreen 2D
 * canvas and wrapped as a Three.js `CanvasTexture`. Used as the screen
 * material for the 3D laptop in the hero.
 *
 * The drawing is intentionally simple: sidebar, file tree, syntax-highlighted
 * code, status bar. All shapes are vector-style rects + text — no images.
 * Returns a texture ready to plug into a `MeshBasicMaterial({ map })`.
 */

export const LAPTOP_SCREEN_WIDTH = 1280;
export const LAPTOP_SCREEN_HEIGHT = 800;

// VS Code–style palette (dark+).
const COLORS = {
  bg:        '#1e1e1e',
  sidebar:   '#252526',
  activity:  '#333333',
  tabBg:     '#2d2d2d',
  tabActive: '#1e1e1e',
  breadcrumb:'#858585',
  text:      '#d4d4d4',
  textMuted: '#858585',
  border:    '#1e1e1e',
  caret:     '#569cd6',
  keyword:   '#c586c0',
  string:    '#ce9178',
  className: '#4ec9b0',
  function:  '#dcdcaa',
  comment:   '#6a9955',
  number:    '#b5cea8',
  decorator: '#dcdcaa',
  bracket:   '#ffd700',
  status:    '#007acc',
  red:       '#ff5f57',
  yellow:    '#febc2e',
  green:     '#28c840',
} as const;

const FONT_MONO = 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace';

interface Token {
  text: string;
  color: string;
}

/**
 * Tokenize a single line of code into color spans. Order matters: more
 * specific patterns are tried first so e.g. `@Component` is caught before
 * the bare word `Component`.
 */
function tokenize(line: string): Token[] {
  if (!line) return [{ text: ' ', color: COLORS.text }];
  if (line.trimStart().startsWith('//')) {
    return [{ text: line, color: COLORS.comment }];
  }

  // Combined regex: decorators, keywords, types, strings, numbers, comments.
  // We use a single regex with alternation so a single character is matched
  // by exactly one alternative (avoids re-scanning).
  const pattern =
    /(\/\/.*$)|(@[A-Za-z_]\w*)|(`[^`]*`)|('[^']*')|("[^"]*")|(\b\d+(?:\.\d+)?\b)|(\b(?:import|from|const|let|var|export|class|extends|implements|interface|type|enum|public|private|protected|readonly|static|async|await|return|if|else|for|while|switch|case|break|continue|new|this|super|void|null|undefined|true|false|as|in|of|function)\b)|(\b[A-Z][A-Za-z0-9]*(?=<|\(| ))|(\b[a-z_][A-Za-z0-9_]*(?=\s*\())/g;

  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(line)) !== null) {
    if (m.index > last) {
      out.push({ text: line.slice(last, m.index), color: COLORS.text });
    }
    const matched = m[0];
    if (m[1])      out.push({ text: matched, color: COLORS.comment });
    else if (m[2]) out.push({ text: matched, color: COLORS.decorator });
    else if (m[3] || m[4] || m[5]) out.push({ text: matched, color: COLORS.string });
    else if (m[6]) out.push({ text: matched, color: COLORS.number });
    else if (m[7]) out.push({ text: matched, color: COLORS.keyword });
    else if (m[8]) out.push({ text: matched, color: COLORS.className });
    else if (m[9]) out.push({ text: matched, color: COLORS.function });
    else           out.push({ text: matched, color: COLORS.text });
    last = m.index + matched.length;
  }
  if (last < line.length) {
    out.push({ text: line.slice(last), color: COLORS.text });
  }
  return out;
}

// The code that appears on the screen. Kept short (~14 lines) and tight
// to the portfolio's domain: an Angular component, an RxJS stream, a
// BehaviorSubject — i.e. the same things a viewer would expect to see
// on this person's machine.
const SCREEN_CODE: string[] = [
  "import { Component, OnInit } from '@angular/core';",
  "import { BehaviorSubject, Observable } from 'rxjs';",
  '',
  '@Component({',
  "  selector: 'app-hero',",
  "  templateUrl: './hero.component.html',",
  '})',
  'export class HeroComponent implements OnInit {',
  '  readonly title$ = new BehaviorSubject<string>(',
  "    'Dharmender Bishnoi',",
  '  );',
  '',
  '  ngOnInit(): void {',
  '    this.renderCinematicIntro();',
  '  }',
];

const FILE_TREE: Array<{ name: string; indent: number; icon: string }> = [
  { name: 'src',                       indent: 0, icon: '▾' },
  { name: 'app',                       indent: 1, icon: '▾' },
  { name: 'components',                indent: 2, icon: '▾' },
  { name: 'hero',                      indent: 3, icon: '▾' },
  { name: 'hero.component.ts',         indent: 4, icon: '•' },
  { name: 'hero.component.html',       indent: 4, icon: '•' },
  { name: 'hero-visual',               indent: 3, icon: '▾' },
  { name: 'hero-visual.component.ts',  indent: 4, icon: '•' },
  { name: 'projects',                  indent: 3, icon: '▸' },
  { name: 'shared',                    indent: 3, icon: '▸' },
  { name: 'package.json',              indent: 1, icon: '•' },
  { name: 'angular.json',              indent: 1, icon: '•' },
];

export function buildScreenTexture(THREE: any): any {
  const canvas = document.createElement('canvas');
  canvas.width = LAPTOP_SCREEN_WIDTH;
  canvas.height = LAPTOP_SCREEN_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // ── Background ────────────────────────────────────────
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── Activity bar (leftmost strip) ─────────────────────
  const ACT_W = 48;
  ctx.fillStyle = COLORS.activity;
  ctx.fillRect(0, 0, ACT_W, canvas.height);

  // Activity icons — 5 small accent dots, vertically centered.
  ctx.fillStyle = '#6e6e6e';
  for (let i = 0; i < 5; i++) {
    const y = 80 + i * 56;
    ctx.fillStyle = i === 0 ? '#ffffff' : '#6e6e6e';
    ctx.fillRect(20, y, 8, 8);
  }

  // ── Sidebar (file tree) ───────────────────────────────
  const SB_W = 220;
  ctx.fillStyle = COLORS.sidebar;
  ctx.fillRect(ACT_W, 0, SB_W, canvas.height);

  // Sidebar header
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = `600 11px ${FONT_MONO}`;
  ctx.textBaseline = 'top';
  ctx.fillText('EXPLORER', ACT_W + 16, 18);

  // "PORTFOLIO" project line
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 13px ${FONT_MONO}`;
  ctx.fillText('▾ portfolio', ACT_W + 12, 44);

  // File tree
  ctx.font = `13px ${FONT_MONO}`;
  for (let i = 0; i < FILE_TREE.length; i++) {
    const f = FILE_TREE[i];
    const x = ACT_W + 12 + f.indent * 14;
    const y = 76 + i * 22;
    const isActive = f.name === 'hero.component.ts';
    ctx.fillStyle = isActive ? '#ffffff' : COLORS.text;
    ctx.fillText(`${f.icon}  ${f.name}`, x, y);
  }

  // ── Editor area ───────────────────────────────────────
  const ED_X = ACT_W + SB_W;
  const ED_W = canvas.width - ED_X;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(ED_X, 0, ED_W, canvas.height);

  // Tab strip
  const TAB_H = 36;
  ctx.fillStyle = COLORS.tabBg;
  ctx.fillRect(ED_X, 0, ED_W, TAB_H);
  ctx.fillStyle = COLORS.tabActive;
  ctx.fillRect(ED_X, 0, 200, TAB_H);

  // Active tab "x"
  ctx.fillStyle = COLORS.text;
  ctx.font = `13px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('⊕ hero.component.ts', ED_X + 16, TAB_H / 2);
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText('×', ED_X + 175, TAB_H / 2);

  // Tab separator line
  ctx.fillStyle = COLORS.border;
  ctx.fillRect(ED_X, TAB_H - 1, ED_W, 1);

  // Breadcrumb
  ctx.fillStyle = COLORS.breadcrumb;
  ctx.font = `12px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('src ▸ app ▸ components ▸ hero ▸ hero.component.ts', ED_X + 24, TAB_H + 24);

  // ── Code body ─────────────────────────────────────────
  const codeTop = TAB_H + 60;
  const lineHeight = 26;
  ctx.font = `14px ${FONT_MONO}`;
  ctx.textBaseline = 'top';

  // Line numbers gutter
  ctx.fillStyle = '#2d2d2d';
  ctx.fillRect(ED_X, codeTop, 56, lineHeight * SCREEN_CODE.length + 8);

  for (let i = 0; i < SCREEN_CODE.length; i++) {
    const line = SCREEN_CODE[i];
    const y = codeTop + i * lineHeight;

    // Line number
    ctx.fillStyle = COLORS.textMuted;
    ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), ED_X + 44, y + 4);

    // Highlight the current line (line 5) — subtle accent stripe
    if (i === 4) {
      ctx.fillStyle = '#2a2d2e';
      ctx.fillRect(ED_X + 56, y, ED_W - 56, lineHeight);
    }

    // Tokens
    ctx.textAlign = 'left';
    const tokens = tokenize(line);
    let cursorX = ED_X + 72;
    for (const t of tokens) {
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, cursorX, y + 4);
      cursorX += ctx.measureText(t.text).width;
    }
  }

  // Cursor caret on the active line (after "selector: 'app-hero',")
  const caretLine = 4;
  const caretY = codeTop + caretLine * lineHeight + 4;
  ctx.fillStyle = COLORS.caret;
  ctx.fillRect(ED_X + 72 + 200, caretY, 2, 16);

  // ── Status bar ────────────────────────────────────────
  const SB_H = 24;
  ctx.fillStyle = COLORS.status;
  ctx.fillRect(0, canvas.height - SB_H, canvas.width, SB_H);

  ctx.fillStyle = '#ffffff';
  ctx.font = `11px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('⎇ main', 16, canvas.height - SB_H / 2);
  ctx.fillText('● 0 ↓ 0', 100, canvas.height - SB_H / 2);
  ctx.fillText('⊗ 0 ⓘ 0', 180, canvas.height - SB_H / 2);
  ctx.textAlign = 'right';
  ctx.fillText('TypeScript', canvas.width - 16, canvas.height - SB_H / 2);
  ctx.fillText('UTF-8', canvas.width - 130, canvas.height - SB_H / 2);
  ctx.fillText('Spaces: 2', canvas.width - 220, canvas.height - SB_H / 2);

  // ── Wrap as a texture ─────────────────────────────────
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
