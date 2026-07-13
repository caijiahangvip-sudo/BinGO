export const COLOR_THEME_IDS = [
  'warm-storybook',
  'clear-tech',
  'nature-reader',
  'pastel-classroom',
  'night-lecture',
] as const;

export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

export interface ThemeTone {
  readonly background: string;
  readonly foreground: string;
  readonly card: string;
  readonly cardForeground: string;
  readonly popover: string;
  readonly popoverForeground: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly secondary: string;
  readonly secondaryForeground: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly border: string;
  readonly input: string;
  readonly ring: string;
  readonly sidebar: string;
  readonly sidebarForeground: string;
  readonly sidebarAccent: string;
  readonly sidebarBorder: string;
  readonly appGradient: string;
  readonly appSurface: string;
  readonly appSurfaceStrong: string;
  readonly appShadowRgb: string;
}

export interface PresentationPalette {
  readonly background: string;
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly title: string;
  readonly text: string;
  readonly muted: string;
  readonly primary: string;
  readonly primarySoft: string;
  readonly secondary: string;
  readonly secondarySoft: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly success: string;
  readonly successSoft: string;
  readonly warning: string;
  readonly warningSoft: string;
  readonly danger: string;
  readonly border: string;
  readonly divider: string;
  readonly chartColors: readonly string[];
}

export interface ColorThemePreset {
  readonly id: ColorThemeId;
  readonly label: {
    readonly zh: string;
    readonly en: string;
  };
  readonly description: {
    readonly zh: string;
    readonly en: string;
  };
  readonly light: ThemeTone;
  readonly dark: ThemeTone;
  readonly presentation: PresentationPalette;
}

export const DEFAULT_COLOR_THEME_ID: ColorThemeId = 'warm-storybook';

export const COLOR_THEME_PRESETS: readonly ColorThemePreset[] = [
  {
    id: 'warm-storybook',
    label: { zh: '温暖手绘', en: 'Warm Storybook' },
    description: { zh: '柔和自然、像手绘动画课堂', en: 'Soft, natural, storybook classroom' },
    light: {
      background: '#fbf7ee',
      foreground: '#2f2a24',
      card: '#fffdf7',
      cardForeground: '#2f2a24',
      popover: '#fffdf7',
      popoverForeground: '#2f2a24',
      primary: '#4f7d53',
      primaryForeground: '#fffdf7',
      secondary: '#efe4c8',
      secondaryForeground: '#3f372c',
      muted: '#f3ead8',
      mutedForeground: '#746854',
      accent: '#c7773d',
      accentForeground: '#fffaf0',
      border: '#e0d1b5',
      input: '#dfd0b8',
      ring: '#8fab7a',
      sidebar: '#fffaf0',
      sidebarForeground: '#342f29',
      sidebarAccent: '#f1e5ce',
      sidebarBorder: '#e2d3ba',
      appGradient: 'linear-gradient(135deg,#f8f0dc 0%,#dce8c9 50%,#f5d6ba 100%)',
      appSurface: 'rgba(255,253,247,0.88)',
      appSurfaceStrong: 'rgba(255,253,247,0.96)',
      appShadowRgb: '94, 73, 46',
    },
    dark: {
      background: '#191b17',
      foreground: '#f5eddc',
      card: '#24271f',
      cardForeground: '#f5eddc',
      popover: '#24271f',
      popoverForeground: '#f5eddc',
      primary: '#9fbe7a',
      primaryForeground: '#172015',
      secondary: '#343126',
      secondaryForeground: '#efe2c7',
      muted: '#2d2f27',
      mutedForeground: '#c8baa0',
      accent: '#e2a161',
      accentForeground: '#24170e',
      border: '#4a4234',
      input: '#4a4234',
      ring: '#9fbe7a',
      sidebar: '#20231d',
      sidebarForeground: '#f5eddc',
      sidebarAccent: '#303428',
      sidebarBorder: '#47402f',
      appGradient: 'linear-gradient(135deg,#171d15 0%,#263324 52%,#3b2a1e 100%)',
      appSurface: 'rgba(32,35,29,0.82)',
      appSurfaceStrong: 'rgba(36,39,31,0.94)',
      appShadowRgb: '0, 0, 0',
    },
    presentation: {
      background: '#fffaf0',
      surface: '#fffdf7',
      surfaceAlt: '#f3ead8',
      title: '#2f2a24',
      text: '#3f372c',
      muted: '#746854',
      primary: '#4f7d53',
      primarySoft: '#dce8c9',
      secondary: '#5b7f95',
      secondarySoft: '#d9e7ec',
      accent: '#c7773d',
      accentSoft: '#f5d6ba',
      success: '#4f7d53',
      successSoft: '#dce8c9',
      warning: '#c88b2f',
      warningSoft: '#f3dfab',
      danger: '#b85b4a',
      border: '#e0d1b5',
      divider: '#8fab7a',
      chartColors: ['#4f7d53', '#c7773d', '#5b7f95', '#c88b2f', '#8b6f47'],
    },
  },
  {
    id: 'clear-tech',
    label: { zh: '清爽科技', en: 'Clear Tech' },
    description: { zh: '干净、明快、适合理科与结构化内容', en: 'Clean and crisp for STEM' },
    light: {
      background: '#f5fbff',
      foreground: '#102033',
      card: '#ffffff',
      cardForeground: '#102033',
      popover: '#ffffff',
      popoverForeground: '#102033',
      primary: '#2563eb',
      primaryForeground: '#ffffff',
      secondary: '#e0f2fe',
      secondaryForeground: '#0f2f4a',
      muted: '#eaf3fb',
      mutedForeground: '#5c6f82',
      accent: '#06b6d4',
      accentForeground: '#062a31',
      border: '#cfe0ef',
      input: '#cfe0ef',
      ring: '#38bdf8',
      sidebar: '#f8fcff',
      sidebarForeground: '#102033',
      sidebarAccent: '#e0f2fe',
      sidebarBorder: '#d6e6f3',
      appGradient: 'linear-gradient(135deg,#eef9ff 0%,#f7fbff 48%,#e8f0ff 100%)',
      appSurface: 'rgba(255,255,255,0.88)',
      appSurfaceStrong: 'rgba(255,255,255,0.96)',
      appShadowRgb: '37, 99, 235',
    },
    dark: {
      background: '#07111f',
      foreground: '#e8f3ff',
      card: '#0e1b2d',
      cardForeground: '#e8f3ff',
      popover: '#0e1b2d',
      popoverForeground: '#e8f3ff',
      primary: '#60a5fa',
      primaryForeground: '#06101f',
      secondary: '#132a42',
      secondaryForeground: '#d8ecff',
      muted: '#132337',
      mutedForeground: '#9db4cb',
      accent: '#22d3ee',
      accentForeground: '#04191d',
      border: '#26425f',
      input: '#26425f',
      ring: '#38bdf8',
      sidebar: '#0b1625',
      sidebarForeground: '#e8f3ff',
      sidebarAccent: '#10243a',
      sidebarBorder: '#243a54',
      appGradient: 'linear-gradient(135deg,#07111f 0%,#0c2034 52%,#122344 100%)',
      appSurface: 'rgba(11,22,37,0.82)',
      appSurfaceStrong: 'rgba(14,27,45,0.94)',
      appShadowRgb: '0, 0, 0',
    },
    presentation: {
      background: '#f7fbff',
      surface: '#ffffff',
      surfaceAlt: '#eaf3fb',
      title: '#102033',
      text: '#24364a',
      muted: '#5c6f82',
      primary: '#2563eb',
      primarySoft: '#dbeafe',
      secondary: '#0ea5e9',
      secondarySoft: '#e0f2fe',
      accent: '#06b6d4',
      accentSoft: '#cffafe',
      success: '#16a34a',
      successSoft: '#dcfce7',
      warning: '#f59e0b',
      warningSoft: '#fef3c7',
      danger: '#dc2626',
      border: '#cfe0ef',
      divider: '#2563eb',
      chartColors: ['#2563eb', '#0ea5e9', '#06b6d4', '#16a34a', '#f59e0b'],
    },
  },
  {
    id: 'nature-reader',
    label: { zh: '自然阅读', en: 'Nature Reader' },
    description: { zh: '纸张感、森林绿，适合语文阅读', en: 'Paper and forest tones for reading' },
    light: {
      background: '#f7f5ec',
      foreground: '#233026',
      card: '#fffdf6',
      cardForeground: '#233026',
      popover: '#fffdf6',
      popoverForeground: '#233026',
      primary: '#2f7a5b',
      primaryForeground: '#fffdf6',
      secondary: '#e2ead7',
      secondaryForeground: '#263326',
      muted: '#ece7d8',
      mutedForeground: '#68715f',
      accent: '#8f6b3e',
      accentForeground: '#fffaf0',
      border: '#d8d0bd',
      input: '#d8d0bd',
      ring: '#2f7a5b',
      sidebar: '#fcfaef',
      sidebarForeground: '#233026',
      sidebarAccent: '#e8eedf',
      sidebarBorder: '#d8d0bd',
      appGradient: 'linear-gradient(135deg,#f8f4e6 0%,#e4ecd8 54%,#f0e5c9 100%)',
      appSurface: 'rgba(255,253,246,0.88)',
      appSurfaceStrong: 'rgba(255,253,246,0.96)',
      appShadowRgb: '71, 85, 64',
    },
    dark: {
      background: '#101813',
      foreground: '#eef0df',
      card: '#1a241c',
      cardForeground: '#eef0df',
      popover: '#1a241c',
      popoverForeground: '#eef0df',
      primary: '#86c79d',
      primaryForeground: '#08120c',
      secondary: '#283426',
      secondaryForeground: '#e8ebd9',
      muted: '#222b20',
      mutedForeground: '#b9bea7',
      accent: '#d5a76d',
      accentForeground: '#211508',
      border: '#3c4837',
      input: '#3c4837',
      ring: '#86c79d',
      sidebar: '#151f17',
      sidebarForeground: '#eef0df',
      sidebarAccent: '#263123',
      sidebarBorder: '#3b4634',
      appGradient: 'linear-gradient(135deg,#101813 0%,#1d2b1d 54%,#2a2518 100%)',
      appSurface: 'rgba(21,31,23,0.82)',
      appSurfaceStrong: 'rgba(26,36,28,0.94)',
      appShadowRgb: '0, 0, 0',
    },
    presentation: {
      background: '#fffdf6',
      surface: '#ffffff',
      surfaceAlt: '#ece7d8',
      title: '#233026',
      text: '#344239',
      muted: '#68715f',
      primary: '#2f7a5b',
      primarySoft: '#dce9d8',
      secondary: '#64748b',
      secondarySoft: '#e7edf1',
      accent: '#8f6b3e',
      accentSoft: '#eee0c6',
      success: '#2f7a5b',
      successSoft: '#dce9d8',
      warning: '#b9822f',
      warningSoft: '#f1dfb9',
      danger: '#b85b4a',
      border: '#d8d0bd',
      divider: '#2f7a5b',
      chartColors: ['#2f7a5b', '#8f6b3e', '#64748b', '#b9822f', '#5b7f95'],
    },
  },
  {
    id: 'pastel-classroom',
    label: { zh: '粉彩童趣', en: 'Pastel Classroom' },
    description: { zh: '明亮、轻快，适合低龄课堂', en: 'Bright pastels for younger learners' },
    light: {
      background: '#fff7fb',
      foreground: '#35293b',
      card: '#ffffff',
      cardForeground: '#35293b',
      popover: '#ffffff',
      popoverForeground: '#35293b',
      primary: '#8b5cf6',
      primaryForeground: '#ffffff',
      secondary: '#fde7f3',
      secondaryForeground: '#4b2b3c',
      muted: '#f4edff',
      mutedForeground: '#746a80',
      accent: '#f472b6',
      accentForeground: '#3a1027',
      border: '#ead9f7',
      input: '#ead9f7',
      ring: '#c084fc',
      sidebar: '#fffafd',
      sidebarForeground: '#35293b',
      sidebarAccent: '#f4edff',
      sidebarBorder: '#ead9f7',
      appGradient: 'linear-gradient(135deg,#fff1f8 0%,#f4edff 50%,#e7f5ff 100%)',
      appSurface: 'rgba(255,255,255,0.88)',
      appSurfaceStrong: 'rgba(255,255,255,0.96)',
      appShadowRgb: '139, 92, 246',
    },
    dark: {
      background: '#1a1222',
      foreground: '#fff1fb',
      card: '#271b32',
      cardForeground: '#fff1fb',
      popover: '#271b32',
      popoverForeground: '#fff1fb',
      primary: '#c084fc',
      primaryForeground: '#1d1028',
      secondary: '#38243d',
      secondaryForeground: '#ffe7f4',
      muted: '#2f2238',
      mutedForeground: '#cfbddc',
      accent: '#f9a8d4',
      accentForeground: '#2a0e1e',
      border: '#4f385d',
      input: '#4f385d',
      ring: '#c084fc',
      sidebar: '#211729',
      sidebarForeground: '#fff1fb',
      sidebarAccent: '#33243d',
      sidebarBorder: '#4f385d',
      appGradient: 'linear-gradient(135deg,#1a1222 0%,#2b1a3d 50%,#17263a 100%)',
      appSurface: 'rgba(33,23,41,0.82)',
      appSurfaceStrong: 'rgba(39,27,50,0.94)',
      appShadowRgb: '0, 0, 0',
    },
    presentation: {
      background: '#fffafd',
      surface: '#ffffff',
      surfaceAlt: '#f4edff',
      title: '#35293b',
      text: '#4b3f55',
      muted: '#746a80',
      primary: '#8b5cf6',
      primarySoft: '#ede9fe',
      secondary: '#38bdf8',
      secondarySoft: '#e0f2fe',
      accent: '#f472b6',
      accentSoft: '#fce7f3',
      success: '#22c55e',
      successSoft: '#dcfce7',
      warning: '#f59e0b',
      warningSoft: '#fef3c7',
      danger: '#ef4444',
      border: '#ead9f7',
      divider: '#c084fc',
      chartColors: ['#8b5cf6', '#f472b6', '#38bdf8', '#22c55e', '#f59e0b'],
    },
  },
  {
    id: 'night-lecture',
    label: { zh: '深色讲台', en: 'Night Lecture' },
    description: { zh: '低眩光、高对比，适合投屏', en: 'Low-glare high contrast for projection' },
    light: {
      background: '#f4f6fb',
      foreground: '#111827',
      card: '#ffffff',
      cardForeground: '#111827',
      popover: '#ffffff',
      popoverForeground: '#111827',
      primary: '#4f46e5',
      primaryForeground: '#ffffff',
      secondary: '#e5e7eb',
      secondaryForeground: '#111827',
      muted: '#eef1f6',
      mutedForeground: '#5b6472',
      accent: '#14b8a6',
      accentForeground: '#052522',
      border: '#d8dde8',
      input: '#d8dde8',
      ring: '#6366f1',
      sidebar: '#ffffff',
      sidebarForeground: '#111827',
      sidebarAccent: '#eef1f6',
      sidebarBorder: '#d8dde8',
      appGradient: 'linear-gradient(135deg,#eef1f8 0%,#f8fafc 52%,#edf4f3 100%)',
      appSurface: 'rgba(255,255,255,0.88)',
      appSurfaceStrong: 'rgba(255,255,255,0.96)',
      appShadowRgb: '79, 70, 229',
    },
    dark: {
      background: '#0b1020',
      foreground: '#f8fafc',
      card: '#111827',
      cardForeground: '#f8fafc',
      popover: '#111827',
      popoverForeground: '#f8fafc',
      primary: '#818cf8',
      primaryForeground: '#080b14',
      secondary: '#1f2937',
      secondaryForeground: '#e5e7eb',
      muted: '#1b2432',
      mutedForeground: '#aeb8c8',
      accent: '#2dd4bf',
      accentForeground: '#031715',
      border: '#334155',
      input: '#334155',
      ring: '#818cf8',
      sidebar: '#0f172a',
      sidebarForeground: '#f8fafc',
      sidebarAccent: '#182235',
      sidebarBorder: '#303b4d',
      appGradient: 'linear-gradient(135deg,#070b14 0%,#0f172a 54%,#111827 100%)',
      appSurface: 'rgba(15,23,42,0.82)',
      appSurfaceStrong: 'rgba(17,24,39,0.94)',
      appShadowRgb: '0, 0, 0',
    },
    presentation: {
      background: '#0b1020',
      surface: '#111827',
      surfaceAlt: '#1b2432',
      title: '#f8fafc',
      text: '#e5e7eb',
      muted: '#aeb8c8',
      primary: '#818cf8',
      primarySoft: '#27305f',
      secondary: '#2dd4bf',
      secondarySoft: '#143b39',
      accent: '#fbbf24',
      accentSoft: '#4a3613',
      success: '#34d399',
      successSoft: '#123b2d',
      warning: '#fbbf24',
      warningSoft: '#4a3613',
      danger: '#fb7185',
      border: '#334155',
      divider: '#818cf8',
      chartColors: ['#818cf8', '#2dd4bf', '#fbbf24', '#34d399', '#fb7185'],
    },
  },
];

const COLOR_THEME_SET = new Set<string>(COLOR_THEME_IDS);

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return typeof value === 'string' && COLOR_THEME_SET.has(value);
}

export function resolveColorThemeId(value: unknown): ColorThemeId {
  return isColorThemeId(value) ? value : DEFAULT_COLOR_THEME_ID;
}

export function getColorThemePreset(value?: unknown): ColorThemePreset {
  const id = resolveColorThemeId(value);
  return COLOR_THEME_PRESETS.find((preset) => preset.id === id) || COLOR_THEME_PRESETS[0];
}

export function getPresentationPalette(value?: unknown): PresentationPalette {
  return getColorThemePreset(value).presentation;
}
