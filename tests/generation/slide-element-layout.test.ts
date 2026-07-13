import { describe, expect, it } from 'vitest';

import {
  detectCriticalSlideLayoutIssues,
  repairCardTextOverlayLayout,
  repairContainedShapeBounds,
  repairLineElementGeometry,
  repairShortLabelBoxAlignment,
  repairSlideElementLayout,
  repairSlideVisualQuality,
  repairTableCaptionOverlayLayout,
  repairTimelineDiagramLayout,
  repairTopLevelSlideOverlaps,
  repairTriadDiagramAlignment,
} from '@/lib/utils/slide-element-layout';

const rectPath = 'M 0 0 L 1 0 L 1 1 L 0 1 Z';
const viewBox = [1, 1] as const;

function shape(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  fill = '#f1f5f9',
) {
  return {
    id,
    type: 'shape',
    left,
    top,
    width,
    height,
    fill,
    path: rectPath,
    viewBox,
    fixedRatio: false,
  };
}

function circle(id: string, left: number, top: number, diameter: number, fill = '#2563eb') {
  return {
    ...shape(id, left, top, diameter, diameter, fill),
    path: 'M 1 0.5 A 0.5 0.5 0 1 1 0 0.5 A 0.5 0.5 0 1 1 1 0.5 Z',
    fixedRatio: true,
  };
}

function circleWithText(id: string, left: number, top: number, diameter: number, content: string) {
  return {
    ...circle(id, left, top, diameter, '#2563eb'),
    text: {
      content: `<p style="font-size: 28px; font-weight: 700; text-align: center;">${content}</p>`,
      align: 'middle',
      defaultFontName: 'Microsoft YaHei',
      defaultColor: '#ffffff',
    },
  };
}

function shapeWithText(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string,
  content: string,
) {
  return {
    ...shape(id, left, top, width, height, fill),
    text: {
      content: `<p style="font-size: 28px; text-align: center;">${content}</p>`,
      align: 'middle',
      defaultFontName: 'Microsoft YaHei',
      defaultColor: '#0f172a',
    },
  };
}

function text(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  content: string,
) {
  return {
    id,
    type: 'text',
    left,
    top,
    width,
    height,
    content,
    defaultFontName: 'Microsoft YaHei',
    defaultColor: '#111827',
  };
}

function table(id: string, left: number, top: number, width: number, height: number) {
  return {
    id,
    type: 'table',
    left,
    top,
    width,
    height,
    rotate: 0,
    outline: { width: 2, style: 'solid', color: '#bfdbfe' },
    colWidths: [0.22, 0.42, 0.36],
    cellMinHeight: 42,
    data: [
      [
        { id: 'h1', text: '品质' },
        { id: 'h2', text: '对应事例' },
        { id: 'h3', text: '表现方法' },
      ],
      [
        { id: 'r1c1', text: '爱国' },
        { id: 'r1c2', text: '承担科研使命' },
        { id: 'r1c3', text: '国家需要' },
      ],
      [
        { id: 'r2c1', text: '奉献' },
        { id: 'r2c2', text: '隐姓埋名多年' },
        { id: 'r2c3', text: '典型材料' },
      ],
    ],
  };
}

function line(
  id: string,
  left: number,
  top: number,
  start: [number, number],
  end: [number, number],
) {
  return {
    id,
    type: 'line',
    left,
    top,
    width: 6,
    start,
    end,
    style: 'solid',
    color: '#2563eb',
    points: ['', ''] as ['', ''],
  };
}

type LineEndpointElement = {
  left: number;
  top: number;
  start: [number, number];
  end: [number, number];
};

function absoluteLineEndpoints(element: LineEndpointElement) {
  return {
    start: {
      x: element.left + element.start[0],
      y: element.top + element.start[1],
    },
    end: {
      x: element.left + element.end[0],
      y: element.top + element.end[1],
    },
  };
}

function overlaps(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
) {
  return !(
    a.left + a.width <= b.left ||
    b.left + b.width <= a.left ||
    a.top + a.height <= b.top ||
    b.top + b.height <= a.top
  );
}

function expectTextElement<T extends { type: string; id: string }>(
  element: T | undefined,
): T & { content: string; height: number } {
  if (!element || element.type !== 'text') {
    throw new Error(`Expected text element, got ${element?.id || 'missing'}`);
  }
  return element as T & { content: string; height: number };
}

describe('slide element layout repair', () => {
  it('expands a filled container shape to cover child cards', () => {
    const elements = [
      shape('container', 80, 240, 840, 54),
      shape('card-1', 110, 222, 380, 96, '#dbeafe'),
      shape('card-2', 510, 222, 380, 96, '#dcfce7'),
    ];

    const repaired = repairContainedShapeBounds(elements);
    const container = repaired[0];

    expect(container.top).toBeLessThanOrEqual(204);
    expect(container.height).toBeGreaterThanOrEqual(132);
    expect(container.top + container.height).toBeGreaterThanOrEqual(336);
    expect(elements[0].top).toBe(240);
    expect(elements[0].height).toBe(54);
  });

  it('does not expand a container for a single unrelated nearby element', () => {
    const elements = [
      shape('container', 80, 240, 840, 54),
      shape('single-card', 110, 222, 380, 96, '#dbeafe'),
    ];

    const repaired = repairContainedShapeBounds(elements);

    expect(repaired[0]).toEqual(elements[0]);
  });

  it('does not expand vertically stacked peer cards into each other', () => {
    const elements = [
      shape('vertical-card', 714, 146, 250, 96, '#eff6ff'),
      shape('adjacent-card', 714, 262, 250, 96, '#fff7ed'),
      shape('reading-card', 714, 378, 250, 88, '#f8fafc'),
    ];

    const repaired = repairContainedShapeBounds(elements);

    expect(repaired[0]).toEqual(elements[0]);
    expect(repaired[1]).toEqual(elements[1]);
    expect(repaired[2]).toEqual(elements[2]);
  });

  it('moves a generated panel away from a title it partially covers', () => {
    const elements = [
      text(
        'title',
        430,
        248,
        300,
        58,
        '<p style="font-size: 40px; font-weight: 700;">第一单元：杰出人物</p>',
      ),
      shape('left-panel', 70, 160, 430, 260, '#dbeafe'),
      text('left-panel-text', 112, 214, 320, 150, '<p style="font-size: 28px;">第一单元主题</p>'),
    ];

    const repaired = repairTopLevelSlideOverlaps(elements);
    const title = repaired.find((element) => element.id === 'title');
    const panel = repaired.find((element) => element.id === 'left-panel');
    const panelText = repaired.find((element) => element.id === 'left-panel-text');

    expect(title).toEqual(elements[0]);
    expect(panel).toBeDefined();
    expect(panelText).toBeDefined();
    expect(overlaps(title!, panel!)).toBe(false);
    expect(panelText?.left).not.toBe(elements[2].left);
    expect(panelText?.top).not.toBe(elements[2].top);
  });

  it('keeps text centered inside its containing shape as one layout group', () => {
    const elements = [
      shape('card', 120, 220, 280, 90, '#dbeafe'),
      text('card-text', 150, 244, 220, 42, '<p style="font-size: 28px;">人物</p>'),
    ];

    const repaired = repairTopLevelSlideOverlaps(elements);

    expect(repaired).toEqual(elements);
  });

  it('removes duplicated shape text when a card also has a centered text element', () => {
    const elements = [
      shapeWithText('card', 100, 180, 260, 96, '#dbeafe', '关键'),
      text(
        'card-text',
        120,
        210,
        220,
        36,
        '<p style="font-size: 28px; text-align: center;">找到关键语句</p>',
      ),
    ];

    const repaired = repairCardTextOverlayLayout(elements);

    expect(repaired).not.toBe(elements);
    expect((repaired[0] as { text?: unknown }).text).toBeUndefined();
    expect(repaired[1]).toEqual(elements[1]);
  });

  it('removes duplicated shape text from multiple process cards', () => {
    const elements = [
      shapeWithText('card-1', 80, 210, 240, 110, '#dbeafe', '关键'),
      shapeWithText('card-2', 380, 210, 240, 110, '#dcfce7', '品质'),
      shapeWithText('card-3', 680, 210, 240, 110, '#fef3c7', '理由'),
      text(
        'card-text-1',
        100,
        246,
        200,
        38,
        '<p style="font-size: 26px; text-align: center;">找到关键语句</p>',
      ),
      text(
        'card-text-2',
        400,
        246,
        200,
        38,
        '<p style="font-size: 26px; text-align: center;">判断品质</p>',
      ),
      text(
        'card-text-3',
        700,
        246,
        200,
        38,
        '<p style="font-size: 26px; text-align: center;">用理由说明</p>',
      ),
    ];

    const repaired = repairCardTextOverlayLayout(elements);

    expect((repaired[0] as { text?: unknown }).text).toBeUndefined();
    expect((repaired[1] as { text?: unknown }).text).toBeUndefined();
    expect((repaired[2] as { text?: unknown }).text).toBeUndefined();
    expect(repaired.slice(3)).toEqual(elements.slice(3));
  });

  it('keeps standalone shape text when there is no overlay text element', () => {
    const elements = [shapeWithText('card', 100, 180, 260, 96, '#dbeafe', '关键')];

    const repaired = repairCardTextOverlayLayout(elements);

    expect(repaired).toBe(elements);
  });

  it('centers direct shape text in short label boxes', () => {
    const elements = [
      {
        ...shape('keyword-box', 120, 70, 220, 42, '#fff7ed'),
        text: {
          content: '<p style="font-size: 24px;">关键词：不满 / 不解</p>',
          align: 'top',
          defaultFontName: 'Microsoft YaHei',
          defaultColor: '#3f3a32',
        },
      },
    ];

    const repaired = repairShortLabelBoxAlignment(elements);
    const keywordBox = repaired[0] as (typeof elements)[0];

    expect(keywordBox.text.align).toBe('middle');
    expect(keywordBox.text.content).toContain('text-align: center');
  });

  it('centers separate text elements over short label background shapes', () => {
    const elements = [
      shape('keyword-bg', 120, 70, 220, 42, '#fff7ed'),
      text('keyword-text', 124, 72, 160, 30, '<p style="font-size: 24px;">关键词：不满 / 不解</p>'),
    ];

    const repaired = repairSlideElementLayout(elements);
    const keywordText = repaired.find((element) => element.id === 'keyword-text')!;

    expect(keywordText.left).toBe(120);
    expect(keywordText.top).toBe(70);
    expect(keywordText.width).toBe(220);
    expect(keywordText.height).toBe(42);
    expect(String((keywordText as ReturnType<typeof text>).content)).toContain(
      'text-align: center',
    );
  });

  it('does not remove shape text for unrelated contained detail text', () => {
    const elements = [
      shapeWithText('card', 100, 180, 260, 96, '#dbeafe', '步骤一'),
      text(
        'detail-text',
        120,
        210,
        220,
        36,
        '<p style="font-size: 22px; text-align: center;">详细说明</p>',
      ),
    ];

    const repaired = repairCardTextOverlayLayout(elements);

    expect(repaired).toBe(elements);
  });

  it('keeps footer interaction prompts clear when nearby cards collide with them', () => {
    const elements = [
      shape('content-card', 100, 390, 760, 110, '#dbeafe'),
      text('content-text', 140, 424, 680, 40, '<p style="font-size: 24px;">核心活动</p>'),
      shape('footer-strip', 70, 456, 860, 54, '#eef2ff'),
      text(
        'footer-text',
        150,
        468,
        700,
        30,
        '<p style="font-size: 24px;">课堂互动：用一个词预测“杰出人物”的特征</p>',
      ),
    ];

    const repaired = repairTopLevelSlideOverlaps(elements);
    const card = repaired.find((element) => element.id === 'content-card');
    const cardText = repaired.find((element) => element.id === 'content-text');
    const footer = repaired.find((element) => element.id === 'footer-strip');
    const footerText = repaired.find((element) => element.id === 'footer-text');

    expect(footer).toEqual(elements[2]);
    expect(footerText).toEqual(elements[3]);
    expect(card).toBeDefined();
    expect(cardText).toBeDefined();
    expect(overlaps(card!, footer!)).toBe(false);
    expect(cardText?.top).not.toBe(elements[1].top);
  });

  it('ignores large backing panels when repairing foreground card overlaps', () => {
    const elements = [
      shape('map-panel', 196, 132, 300, 332, '#ffffff'),
      shapeWithText('identity-card', 298, 182, 150, 58, '#eff6ff', '人物身份'),
      shapeWithText('event-card', 166, 360, 150, 58, '#ecfdf5', '关键事迹'),
      shapeWithText('method-card', 98, 230, 116, 172, '#e0f2fe', '圈画<br/>批注<br/>概括'),
    ];

    const repaired = repairTopLevelSlideOverlaps(elements);
    const panel = repaired.find((element) => element.id === 'map-panel');
    const identityCard = repaired.find((element) => element.id === 'identity-card');
    const eventCard = repaired.find((element) => element.id === 'event-card');
    const methodCard = repaired.find((element) => element.id === 'method-card');

    expect(panel).toEqual(elements[0]);
    expect(identityCard).toEqual(elements[1]);
    expect(eventCard).toBeDefined();
    expect(methodCard).toBeDefined();
    expect(overlaps(eventCard!, methodCard!)).toBe(false);
  });

  it('repairs screenshot-like review concept map overlaps in the shared layout pipeline', () => {
    const elements = [
      text('title', 64, 54, 820, 64, '<p style="font-size: 36px;">复习导入：杰出人物精读入门</p>'),
      shape('map-panel', 196, 132, 300, 332, '#ffffff'),
      shapeWithText('method-card', 98, 230, 116, 172, '#e0f2fe', '圈画<br/>批注<br/>概括'),
      shapeWithText('event-card', 166, 360, 150, 58, '#ecfdf5', '关键事迹'),
      shapeWithText('read-circle', 475, 225, 150, 150, '#dbeafe', '精读<br/>入门'),
      shapeWithText('language-card', 430, 360, 150, 58, '#fff7ed', '语言细节'),
      shapeWithText('right-card', 714, 150, 250, 90, '#1e3a8a', '复习范围<br/>《邓稼先》人物品质'),
      shapeWithText(
        'footer',
        64,
        486,
        900,
        46,
        '#e2e8f0',
        '课堂互动：用一个细节，说出邓稼先的一种品质',
      ),
    ];

    const repaired = repairSlideElementLayout(elements);
    const methodCard = repaired.find((element) => element.id === 'method-card');
    const eventCard = repaired.find((element) => element.id === 'event-card');
    const readCircle = repaired.find((element) => element.id === 'read-circle');
    const languageCard = repaired.find((element) => element.id === 'language-card');
    const rightCard = repaired.find((element) => element.id === 'right-card');
    const footer = repaired.find((element) => element.id === 'footer');

    expect(methodCard).toBeDefined();
    expect(eventCard).toBeDefined();
    expect(readCircle).toBeDefined();
    expect(languageCard).toBeDefined();
    expect(rightCard).toEqual(elements[6]);
    expect(footer).toEqual(elements[7]);
    expect(overlaps(methodCard!, eventCard!)).toBe(false);
    expect(overlaps(readCircle!, languageCard!)).toBe(false);
  });

  it('turns intrusive non-header dark panels into low-interference backdrops', () => {
    const elements = [
      shapeWithText('title-card', 64, 28, 872, 72, '#0f172a', '复习导入'),
      shape('dark-panel', 240, 240, 700, 280, '#111111'),
      shapeWithText('student-card', 80, 390, 390, 80, '#ffffff', '学生：圈出一个“卡点”'),
      shapeWithText('teacher-card', 520, 390, 390, 80, '#ffffff', '老师：收集并点亮Bingo'),
    ];

    const repaired = repairSlideElementLayout(elements);
    const titleCard = repaired.find((element) => element.id === 'title-card') as ReturnType<
      typeof shapeWithText
    >;
    const darkPanel = repaired.find((element) => element.id === 'dark-panel') as ReturnType<
      typeof shape
    >;

    expect(titleCard.fill).toBe('#0f172a');
    expect(darkPanel.fill).toBe('#f8fafc');
    expect(repaired.findIndex((element) => element.id === 'dark-panel')).toBeLessThan(
      repaired.findIndex((element) => element.id === 'student-card'),
    );
    expect(repaired.findIndex((element) => element.id === 'dark-panel')).toBeLessThan(
      repaired.findIndex((element) => element.id === 'teacher-card'),
    );
  });

  it('snaps arrow connectors outside node boundaries and places lines behind nodes', () => {
    const elements = [
      shapeWithText('concept-card', 120, 230, 180, 78, '#ffffff', '概念 A'),
      {
        ...circle('judge-node', 410, 228, 86, '#fef3c7'),
        text: {
          content: '<p style="font-size: 24px; text-align: center;">辨</p>',
          align: 'middle',
          defaultFontName: 'Microsoft YaHei',
          defaultColor: '#0f172a',
        },
      },
      {
        ...line('connector', 0, 0, [220, 270], [452, 270]),
        points: ['', 'arrow'] as ['', 'arrow'],
      },
    ];

    const repaired = repairSlideElementLayout(elements);
    const connector = repaired.find(
      (element) => element.id === 'connector',
    ) as unknown as LineEndpointElement;
    const endpoints = absoluteLineEndpoints(connector);

    expect(endpoints.start.x).toBeGreaterThan(300);
    expect(endpoints.start.x).toBeLessThanOrEqual(310);
    expect(endpoints.end.x).toBeLessThan(410);
    expect(endpoints.end.x).toBeGreaterThanOrEqual(398);
    expect(repaired.findIndex((element) => element.id === 'connector')).toBeLessThan(
      repaired.findIndex((element) => element.id === 'concept-card'),
    );
    expect(repaired.findIndex((element) => element.id === 'connector')).toBeLessThan(
      repaired.findIndex((element) => element.id === 'judge-node'),
    );
  });

  it('clamps straight connector endpoints back inside the canvas', () => {
    const elements = [line('runaway-line', 960, 280, [0, 0], [180, 0])];

    const repaired = repairSlideElementLayout(elements);
    const connector = repaired[0] as ReturnType<typeof line>;
    const endpoints = absoluteLineEndpoints(connector);

    expect(endpoints.start.x).toBe(960);
    expect(endpoints.end.x).toBe(988);
  });

  it('normalizes generated line geometry and clamps oversized arrow strokes', () => {
    const elements = [
      {
        ...line('bad-arrow', 330, 210, [-30, 40], [80, 0]),
        width: 60,
        points: ['', 'arrow'] as ['', 'arrow'],
      },
    ];

    const repaired = repairLineElementGeometry(elements);
    const connector = repaired[0] as LineEndpointElement & { width: number };
    const endpoints = absoluteLineEndpoints(connector);

    expect(connector.width).toBe(6);
    expect(connector.left).toBe(300);
    expect(connector.top).toBe(210);
    expect(connector.start[0]).toBeGreaterThanOrEqual(0);
    expect(connector.start[1]).toBeGreaterThanOrEqual(0);
    expect(connector.end[0]).toBeGreaterThanOrEqual(0);
    expect(connector.end[1]).toBeGreaterThanOrEqual(0);
    expect(endpoints.start).toEqual({ x: 300, y: 250 });
    expect(endpoints.end).toEqual({ x: 410, y: 210 });
  });

  it('expands short semantic arrows so they remain visible and repairable', () => {
    const elements = [
      {
        ...line('short-arrow', 342, 296, [0, 0], [34, 0]),
        points: ['', 'arrow'] as ['', 'arrow'],
      },
    ];

    const repaired = repairLineElementGeometry(elements);
    const connector = repaired[0] as LineEndpointElement;
    const endpoints = absoluteLineEndpoints(connector);

    expect(endpoints.end.x - endpoints.start.x).toBeGreaterThanOrEqual(44);
    expect((endpoints.start.x + endpoints.end.x) / 2).toBeCloseTo(342 + 17, 1);
  });

  it('aligns generated three-part relationship triangle diagrams', () => {
    const triangle = {
      ...shape('triangle-bg', 130, 18, 760, 500, '#dbeafe'),
      path: 'M 100 0 L 0 200 L 200 200 L 100 0 Z',
      viewBox: [200, 200] as const,
      pptxShapeType: 'triangle',
      opacity: 0.55,
    };
    const circle = {
      ...shape('center-circle', 438, 236, 148, 148, '#ffffff'),
      path: 'M 1 0.5 A 0.5 0.5 0 1 1 0 0.5 A 0.5 0.5 0 1 1 1 0.5 Z',
    };
    const elements = [
      triangle,
      line('left-top-line', 215, 160, [0, 290], [298, 0]),
      line('right-top-line', 505, 160, [0, 0], [310, 290]),
      line('bottom-line', 213, 450, [0, 0], [604, 0]),
      circle,
      text(
        'center-text',
        350,
        275,
        470,
        44,
        '<p style="font-size: 32px;">从文本细节，看见人物精神</p>',
      ),
      shapeWithText('top-node', 448, 84, 134, 108, '#1d4ed8', '事迹'),
      shapeWithText('left-node', 118, 414, 145, 110, '#60a5fa', '语言'),
      shapeWithText('right-node', 766, 414, 145, 110, '#bfdbfe', '品质'),
    ];

    const repaired = repairTriadDiagramAlignment(elements);
    const topNode = repaired.find((element) => element.id === 'top-node') as ReturnType<
      typeof shapeWithText
    >;
    const leftNode = repaired.find((element) => element.id === 'left-node') as ReturnType<
      typeof shapeWithText
    >;
    const rightNode = repaired.find((element) => element.id === 'right-node') as ReturnType<
      typeof shapeWithText
    >;
    const centerText = repaired.find((element) => element.id === 'center-text') as ReturnType<
      typeof text
    >;
    const repairedBottomLine = repaired.find(
      (element) => element.id === 'bottom-line',
    ) as ReturnType<typeof line>;
    const bottomLineEndpoints = absoluteLineEndpoints(repairedBottomLine);

    expect(repaired).not.toBe(elements);
    expect(topNode.left + topNode.width / 2).toBeCloseTo(500, 1);
    expect(topNode.top).toBe(72);
    expect(leftNode.left).toBe(118);
    expect(rightNode.left + rightNode.width).toBe(882);
    expect(leftNode.top).toBe(rightNode.top);
    expect(bottomLineEndpoints.start.x).toBeCloseTo(leftNode.left + leftNode.width, 1);
    expect(bottomLineEndpoints.end.x).toBeCloseTo(rightNode.left, 1);
    expect(bottomLineEndpoints.start.y).toBeCloseTo(leftNode.top + leftNode.height / 2, 1);
    expect(String(centerText.content).match(/<p/g)?.length).toBe(2);
    expect(String(centerText.content)).toContain('从文本细节');
    expect(String(centerText.content)).toContain('看见人物精神');

    const triangleIndex = repaired.findIndex((element) => element.id === 'triangle-bg');
    const lineIndex = repaired.findIndex((element) => element.id === 'bottom-line');
    const nodeIndex = repaired.findIndex((element) => element.id === 'left-node');
    expect(triangleIndex).toBeLessThan(lineIndex);
    expect(lineIndex).toBeLessThan(nodeIndex);
  });

  it('does not realign ordinary three-card layouts without connector lines', () => {
    const elements = [
      shapeWithText('one', 100, 120, 150, 64, '#dbeafe', '原因'),
      shapeWithText('two', 420, 120, 150, 64, '#dcfce7', '过程'),
      shapeWithText('three', 740, 120, 150, 64, '#fef3c7', '结果'),
    ];

    const repaired = repairTriadDiagramAlignment(elements);

    expect(repaired).toBe(elements);
  });

  it('centers timeline node labels and moves text away from the horizontal line', () => {
    const elements = [
      line('timeline-axis', 250, 300, [0, 0], [500, 0]),
      circle('node-1', 280, 284, 32),
      circle('node-2', 430, 284, 32),
      circle('node-3', 580, 284, 32),
      circle('node-4', 730, 284, 32),
      text('label-1', 205, 240, 80, 32, '<p style="font-size: 20px;">求学</p>'),
      text('label-2', 355, 332, 80, 32, '<p style="font-size: 20px;">归国</p>'),
      text('label-3', 505, 240, 80, 32, '<p style="font-size: 20px;">科研</p>'),
      text('label-4', 655, 332, 80, 32, '<p style="font-size: 20px;">奉献</p>'),
      text(
        'axis-title',
        390,
        286,
        260,
        36,
        '<p style="font-size: 22px;">时间线：人物选择与时代坐标</p>',
      ),
    ];

    const repaired = repairTimelineDiagramLayout(elements);
    const label1 = expectTextElement(repaired.find((element) => element.id === 'label-1'));
    const label2 = repaired.find((element) => element.id === 'label-2')!;
    const label3 = repaired.find((element) => element.id === 'label-3')!;
    const label4 = repaired.find((element) => element.id === 'label-4')!;
    const axisTitle = expectTextElement(repaired.find((element) => element.id === 'axis-title'));

    expect(label1.left + label1.width / 2).toBeCloseTo(296, 1);
    expect(label2.left + label2.width / 2).toBeCloseTo(446, 1);
    expect(label3.left + label3.width / 2).toBeCloseTo(596, 1);
    expect(label4.left + label4.width / 2).toBeCloseTo(746, 1);
    expect(String(label1.content)).toContain('text-align: center');
    expect(axisTitle.top + axisTitle.height <= 276 || axisTitle.top >= 324).toBe(true);
  });

  it('does not alter ordinary text and cards without timeline nodes', () => {
    const elements = [
      line('divider', 64, 126, [0, 0], [872, 0]),
      text('title', 64, 54, 820, 64, '<p style="font-size: 36px;">课堂标题</p>'),
      shape('card', 120, 180, 300, 90, '#dbeafe'),
      text('card-text', 150, 204, 240, 42, '<p style="font-size: 22px;">普通卡片</p>'),
    ];

    const repaired = repairTimelineDiagramLayout(elements);

    expect(repaired).toBe(elements);
  });

  it('does not rewrite review warm-up content into a Bingo grid', () => {
    const elements = [
      shape('header', 24, 18, 952, 118, '#2563eb'),
      text('title', 300, 66, 420, 44, '<p style="font-size: 32px;">复习导入 | Bingo 热身</p>'),
      shape('grid-panel', 24, 154, 560, 312, '#ffffff'),
      text('kw-1', 52, 245, 120, 30, '<p style="font-size: 18px;">杰出人物</p>'),
      text('kw-2', 230, 245, 120, 30, '<p style="font-size: 18px;">精读方法</p>'),
      text('kw-3', 408, 245, 120, 30, '<p style="font-size: 18px;">邓稼先品质</p>'),
      text('kw-4', 52, 325, 120, 30, '<p style="font-size: 18px;">说和做</p>'),
      text(
        'center-bingo',
        190,
        292,
        260,
        42,
        '<p style="font-size: 24px;">复习 Bingo：听到线索，圈出关键词</p>',
      ),
      text('kw-5', 408, 325, 120, 30, '<p style="font-size: 18px;">孙权劝学</p>'),
      text('kw-6', 52, 402, 120, 30, '<p style="font-size: 18px;">文言阅读</p>'),
      text('kw-7', 230, 402, 120, 30, '<p style="font-size: 18px;">旧知连接</p>'),
      text('kw-8', 408, 402, 120, 30, '<p style="font-size: 18px;">先补问题</p>'),
      shapeWithText('goal-1', 674, 166, 250, 84, '#eef2ff', '目标 1'),
      shapeWithText('goal-2', 674, 278, 250, 84, '#ecfdf5', '目标 2'),
      shapeWithText('goal-3', 674, 390, 250, 84, '#fff7ed', '目标 3'),
      text(
        'teacher-prompt',
        92,
        506,
        360,
        32,
        '<p style="font-size: 18px;">教师提问：哪一格最需要补足？</p>',
      ),
    ];

    const repaired = repairSlideElementLayout(elements);
    const repairedCells = repaired.filter((element) => element.id.startsWith('repair_bingo_cell_'));
    const scatteredKeywords = repaired.filter((element) => /^kw-\d+$/.test(element.id));
    const centerBingo = repaired.find((element) => element.id === 'center-bingo');
    const goal1 = repaired.find((element) => element.id === 'goal-1');
    const teacherPrompt = repaired.find((element) => element.id === 'teacher-prompt');

    expect(repairedCells).toHaveLength(0);
    expect(scatteredKeywords).toHaveLength(8);
    expect(centerBingo).toMatchObject({
      id: 'center-bingo',
      type: 'text',
      content: '<p style="font-size: 24px;">复习 Bingo：听到线索，圈出关键词</p>',
    });
    expect(goal1).toEqual(elements[12]);
    expect(teacherPrompt).toEqual(elements[15]);
  });

  it('moves table overlay captions above the table instead of leaving them over rows', () => {
    const elements = [
      text('title', 64, 54, 820, 64, '<p style="font-size: 36px;">复习：邓稼先的品质</p>'),
      table('quality-table', 24, 210, 560, 236),
      text(
        'floating-caption',
        200,
        292,
        360,
        36,
        '<p style="font-size: 22px;">人物品质表：关键词—事例—写法</p>',
      ),
      shapeWithText('keyword-card', 690, 168, 250, 88, '#eef2ff', '关键词'),
    ];

    const repaired = repairTableCaptionOverlayLayout(elements);
    const repairedCaption = expectTextElement(
      repaired.find((element) => element.id === 'floating-caption'),
    );
    const qualityTable = repaired.find((element) => element.id === 'quality-table')!;

    expect(repairedCaption.top + repairedCaption.height).toBeLessThanOrEqual(qualityTable.top - 8);
    expect(repairedCaption.left + repairedCaption.width / 2).toBeCloseTo(
      qualityTable.left + qualityTable.width / 2,
      1,
    );
    expect(String(repairedCaption.content)).toContain('text-align: center');
  });

  it('removes table overlay captions when there is no safe space above the table', () => {
    const elements = [
      text('title', 64, 42, 820, 60, '<p style="font-size: 34px;">人物品质表</p>'),
      table('quality-table', 64, 142, 640, 240),
      text(
        'floating-caption',
        210,
        232,
        360,
        36,
        '<p style="font-size: 22px;">人物品质表：关键词—事例—写法</p>',
      ),
    ];

    const repaired = repairTableCaptionOverlayLayout(elements);

    expect(repaired.some((element) => element.id === 'floating-caption')).toBe(false);
    expect(repaired.some((element) => element.id === 'quality-table')).toBe(true);
  });

  it('detects critical text overlays left inside table bodies', () => {
    const elements = [
      table('quality-table', 64, 180, 640, 240),
      text(
        'floating-caption',
        210,
        260,
        360,
        42,
        '<p style="font-size: 22px;">人物品质表：关键词—事例—写法</p>',
      ),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);

    expect(issues.some((issue) => issue.type === 'table-text-overlay')).toBe(true);
  });

  it('does not report a table caption after the shared repair moves it above the table', () => {
    const elements = [
      table('quality-table', 24, 210, 560, 236),
      text(
        'floating-caption',
        200,
        292,
        360,
        36,
        '<p style="font-size: 22px;">人物品质表：关键词—事例—写法</p>',
      ),
    ];

    const repaired = repairSlideElementLayout(elements);
    const issues = detectCriticalSlideLayoutIssues(repaired);

    expect(issues.some((issue) => issue.type === 'table-text-overlay')).toBe(false);
  });

  it('detects large unrepaired text-to-text overlaps', () => {
    const elements = [
      text('first-text', 24, 24, 940, 500, '<p style="font-size: 32px;">第一层文字</p>'),
      text('second-text', 36, 40, 920, 480, '<p style="font-size: 30px;">第二层文字</p>'),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);

    expect(issues.some((issue) => issue.type === 'text-text-overlap')).toBe(true);
  });

  it('detects arrow connectors crossing through unrelated content', () => {
    const elements = [
      {
        ...line('bad-arrow', 0, 0, [60, 280], [940, 280]),
        points: ['', 'arrow'] as ['', 'arrow'],
      },
      shapeWithText('content-card', 410, 238, 180, 86, '#eef2ff', '核心概念'),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);

    expect(issues.some((issue) => issue.type === 'connector-obstructs-content')).toBe(true);
  });

  it('reroutes arrow connectors that cross unrelated content blocks', () => {
    const elements = [
      {
        ...line('bad-arrow', 0, 0, [60, 280], [940, 280]),
        points: ['', 'arrow'] as ['', 'arrow'],
      },
      shapeWithText('content-card', 410, 238, 180, 86, '#eef2ff', '核心概念'),
    ];

    const repaired = repairSlideElementLayout(elements);
    const connector = repaired.find((element) => element.id === 'bad-arrow') as
      | (ReturnType<typeof line> & { broken?: [number, number] })
      | undefined;
    const issues = detectCriticalSlideLayoutIssues(repaired);

    expect(repaired.some((element) => element.id === 'content-card')).toBe(true);
    expect(connector).toBeDefined();
    expect(connector?.broken).toBeDefined();
    expect(issues.some((issue) => issue.type === 'connector-obstructs-content')).toBe(false);
  });

  it('detects foreground block overlaps in numbered step diagrams', () => {
    const elements = [
      shapeWithText('flow-strip', 285, 170, 320, 58, '#eaf3ff', '从文本语言进入情感理解'),
      shapeWithText('step-3-card', 500, 210, 170, 200, '#93c5fd', '读<br/>语气<br/>节奏'),
      circleWithText('badge-3', 514, 232, 58, '3'),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);

    expect(issues.some((issue) => issue.type === 'foreground-block-overlap')).toBe(true);
  });

  it('repairs screenshot-like numbered step flow diagrams', () => {
    const elements = [
      shapeWithText('step-1-card', 110, 230, 180, 110, '#dbeafe', '找<br/>情感词'),
      circleWithText('badge-1', 126, 360, 58, '1'),
      shapeWithText('step-2-card', 300, 270, 180, 140, '#bfdbfe', '看<br/>意象<br/>行动'),
      circleWithText('badge-2', 318, 294, 58, '2'),
      shapeWithText('step-3-card', 500, 210, 170, 200, '#93c5fd', '读<br/>语气<br/>节奏'),
      circleWithText('badge-3', 514, 232, 58, '3'),
      shapeWithText('flow-strip', 285, 170, 320, 58, '#eaf3ff', '从文本语言进入情感理解'),
    ];

    const repaired = repairSlideElementLayout(elements);
    const step1 = repaired.find((element) => element.id === 'step-1-card')!;
    const badge1 = repaired.find((element) => element.id === 'badge-1')!;
    const step3 = repaired.find((element) => element.id === 'step-3-card')!;
    const strip = repaired.find((element) => element.id === 'flow-strip')!;
    const issues = detectCriticalSlideLayoutIssues(repaired);

    expect(strip.top + strip.height).toBeLessThanOrEqual(step3.top - 10);
    expect(overlaps(strip, step3)).toBe(false);
    expect(badge1.left).toBeGreaterThanOrEqual(step1.left);
    expect(badge1.top).toBeGreaterThanOrEqual(step1.top);
    expect(badge1.left + badge1.width).toBeLessThanOrEqual(step1.left + step1.width);
    expect(badge1.top + badge1.height).toBeLessThanOrEqual(step1.top + step1.height);
    expect(issues.some((issue) => issue.type === 'foreground-block-overlap')).toBe(false);
  });

  it('reserves text space when numbered badges sit inside step cards', () => {
    const elements = [
      shapeWithText(
        'step-1-card',
        84,
        148,
        188,
        146,
        '#efe6d4',
        '细节入手<br/>动作·语言<br/>神态·物件',
      ),
      circleWithText('badge-1', 106, 166, 42, '1'),
      shapeWithText(
        'step-2-card',
        310,
        326,
        188,
        146,
        '#e6f0e4',
        '小事见人<br/>真实情感<br/>人物品格',
      ),
      circleWithText('badge-2', 332, 344, 42, '2'),
    ];

    const issuesBefore = detectCriticalSlideLayoutIssues(elements);
    expect(issuesBefore.some((issue) => issue.type === 'numbered-badge-text-overlap')).toBe(true);

    const repaired = repairSlideElementLayout(elements);
    const step1 = repaired.find((element) => element.id === 'step-1-card')!;
    const step2 = repaired.find((element) => element.id === 'step-2-card')!;
    const issuesAfter = detectCriticalSlideLayoutIssues(repaired);

    expect(JSON.stringify(step1)).toContain('--bingo-badge-reserved');
    expect(JSON.stringify(step2)).toContain('--bingo-badge-reserved');
    expect(issuesAfter.some((issue) => issue.type === 'numbered-badge-text-overlap')).toBe(false);
  });

  it('detects arrows running through centered card text', () => {
    const elements = [
      shapeWithText(
        'practice-card',
        140,
        180,
        260,
        190,
        '#dbeafe',
        '先做后说<br/>言行一致<br/>说到做到',
      ),
      {
        ...line('bad-inner-arrow', 0, 0, [270, 198], [270, 352]),
        points: ['', 'arrow'] as ['', 'arrow'],
      },
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);

    expect(issues.some((issue) => issue.type === 'connector-obstructs-text')).toBe(true);
  });

  it('keeps unrepaired semantic arrows so layout gates can fallback instead of deleting them', () => {
    const elements = [
      shapeWithText(
        'practice-card',
        140,
        180,
        260,
        190,
        '#dbeafe',
        '先做后说<br/>言行一致<br/>说到做到',
      ),
      {
        ...line('bad-inner-arrow', 0, 0, [270, 198], [270, 352]),
        points: ['', 'arrow'] as ['', 'arrow'],
      },
    ];

    const repaired = repairSlideElementLayout(elements);
    const issues = detectCriticalSlideLayoutIssues(repaired);

    expect(repaired.some((element) => element.id === 'practice-card')).toBe(true);
    expect(repaired.some((element) => element.id === 'bad-inner-arrow')).toBe(true);
    expect(issues.some((issue) => issue.type === 'connector-obstructs-text')).toBe(true);
  });

  it('repairs post-theme dark body panels without covering the title region', () => {
    const elements = [
      text(
        'title',
        64,
        52,
        360,
        58,
        '<p style="font-size: 30px; font-weight: 700;">观察生活中的语言</p>',
      ),
      shape('dark-body-panel', 140, 0, 820, 562.5, '#3f372c'),
      shape('card-1', 180, 190, 230, 140, '#f3ead8'),
      text('card-1-text', 210, 230, 170, 48, '<p style="font-size: 20px;">看见语言</p>'),
    ];

    const repaired = repairSlideVisualQuality(elements, { bodyPanelFill: '#f3ead8' });
    const panel = repaired.find((element) => element.id === 'dark-body-panel');
    const titleIndex = repaired.findIndex((element) => element.id === 'title');
    const panelIndex = repaired.findIndex((element) => element.id === 'dark-body-panel');

    expect(panel).toMatchObject({
      fill: '#f3ead8',
      top: 128,
      height: 434.5,
    });
    expect(panelIndex).toBeGreaterThanOrEqual(0);
    expect(titleIndex).toBeGreaterThan(panelIndex);
  });

  it('flags text that would overflow its own visible box', () => {
    const elements = [
      text(
        'overflow-text',
        120,
        220,
        220,
        36,
        '<p style="font-size: 24px;">人物写具体</p><p style="font-size: 22px;">阅读记清楚</p><p style="font-size: 22px;">品味细节</p>',
      ),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);

    expect(issues.some((issue) => issue.type === 'text-overflows-box')).toBe(true);
  });

  it('flags card text that has been separated from its backing shape', () => {
    const elements = [
      shape('card', 12, 212.5, 144, 116, '#f3ead8'),
      text(
        'detached-card-text',
        168,
        214.5,
        262,
        79,
        '<p style="font-size: 19px; text-align: center;">核心任务</p><p style="font-size: 17px; text-align: center;">人物写具体 | 阅读记清楚</p>',
      ),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);

    expect(issues.some((issue) => issue.type === 'text-outside-container')).toBe(true);
  });

  it('flags uncentered short box text and clears it after shared repair', () => {
    const elements = [
      shape('keyword-bg', 120, 220, 280, 72, '#fff7ed'),
      text('keyword-text', 132, 226, 120, 32, '<p style="font-size: 24px;">关键词</p>'),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);
    const repaired = repairSlideElementLayout(elements);
    const repairedIssues = detectCriticalSlideLayoutIssues(repaired);

    expect(issues.some((issue) => issue.type === 'box-text-not-centered')).toBe(true);
    expect(repairedIssues.some((issue) => issue.type === 'box-text-not-centered')).toBe(false);
  });

  it('centers the only short transparent text label inside a card', () => {
    const elements = [
      shape('card', 120, 190, 244, 210, '#fff7ed'),
      text('card-label', 148, 264, 188, 44, '<p style="font-size: 24px;">动作</p>'),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);
    const repaired = repairSlideElementLayout(elements);
    const repairedLabel = repaired.find((element) => element.id === 'card-label')!;
    const repairedIssues = detectCriticalSlideLayoutIssues(repaired);

    expect(issues.some((issue) => issue.type === 'box-text-not-centered')).toBe(true);
    expect(repairedLabel.left + repairedLabel.width / 2).toBeCloseTo(120 + 244 / 2, 1);
    expect(repairedLabel.top + repairedLabel.height / 2).toBeCloseTo(190 + 210 / 2, 1);
    expect(repairedLabel.width).toBe(188);
    expect(repairedLabel.height).toBe(44);
    expect(String((repairedLabel as ReturnType<typeof text>).content)).toContain(
      'text-align: center',
    );
    expect(repairedIssues.some((issue) => issue.type === 'box-text-not-centered')).toBe(false);
  });

  it('flags screenshot-like low-density three-card layouts', () => {
    const elements = [
      shape('card-1', 76, 156, 260, 320, '#ffffff'),
      text('card-1-title', 120, 294, 172, 42, '<p style="font-size: 24px;">旧知扫描</p>'),
      text(
        'card-1-points',
        110,
        372,
        190,
        84,
        '<p style="font-size: 16px;">• 精读方法</p><p style="font-size: 16px;">• 杰出人物</p>',
      ),
      shape('card-2', 370, 156, 260, 320, '#ffffff'),
      text('card-2-title', 414, 294, 172, 42, '<p style="font-size: 24px;">课文支点</p>'),
      text(
        'card-2-points',
        404,
        372,
        190,
        84,
        '<p style="font-size: 16px;">• 《邓稼先》品质</p><p style="font-size: 16px;">• 《说和做》言行</p>',
      ),
      shape('card-3', 664, 156, 260, 320, '#ffffff'),
      text('card-3-title', 708, 294, 172, 42, '<p style="font-size: 24px;">先补问题</p>'),
      text(
        'card-3-points',
        698,
        372,
        190,
        84,
        '<p style="font-size: 16px;">• 品质关键词</p><p style="font-size: 16px;">• 人物特点</p>',
      ),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);

    expect(issues.some((issue) => issue.type === 'low-density-three-card-layout')).toBe(true);
  });

  it('flags legacy four-card task grids with decorative dots and footer strips', () => {
    const elements = [
      text(
        'title',
        78,
        74,
        760,
        58,
        '<p style="font-size: 30px;">进入新课：细节写作与整本书笔记</p>',
      ),
      line('title-rule', 64, 130, [0, 0], [872, 0]),
      shape('label-strip', 104, 160, 170, 34, '#dce8c9'),
      text('label-text', 118, 166, 140, 24, '<p style="font-size: 18px;">本课学习任务</p>'),
      circle('dot-1', 80, 226, 14, '#c7773d'),
      circle('dot-2', 500, 226, 14, '#4f7d53'),
      circle('dot-3', 80, 348, 14, '#5b7f95'),
      circle('dot-4', 500, 348, 14, '#c88b2f'),
      shape('card-1', 104, 196, 390, 116, '#f3ead8'),
      text('card-1-title', 250, 226, 110, 28, '<p style="font-size: 20px;">核心任务</p>'),
      text(
        'card-1-detail',
        196,
        262,
        210,
        30,
        '<p style="font-size: 18px;">人物写具体 | 阅读记清楚</p>',
      ),
      shape('card-2', 524, 196, 390, 116, '#dce8c9'),
      text('card-2-title', 670, 226, 110, 28, '<p style="font-size: 20px;">细节写作</p>'),
      text(
        'card-2-detail',
        616,
        262,
        210,
        30,
        '<p style="font-size: 18px;">看见人物 | 听见声音</p>',
      ),
      shape('card-3', 104, 326, 390, 116, '#d9e7ec'),
      text('card-3-title', 250, 356, 110, 28, '<p style="font-size: 20px;">整本书笔记</p>'),
      text(
        'card-3-detail',
        196,
        392,
        210,
        30,
        '<p style="font-size: 18px;">追踪人物变化 | 主题线索</p>',
      ),
      shape('card-4', 524, 326, 390, 116, '#f3dfab'),
      text('card-4-title', 648, 356, 160, 28, '<p style="font-size: 20px;">阅读重点</p>'),
      text(
        'card-4-detail',
        616,
        392,
        210,
        30,
        '<p style="font-size: 18px;">命运 | 社会环境 | 语言风格</p>',
      ),
      shape('footer-strip', 64, 470, 872, 46, '#efe4c8'),
      text(
        'footer-text',
        312,
        482,
        380,
        24,
        '<p style="font-size: 16px;">课堂互动：从祥子的一个动作，猜一猜人物状态</p>',
      ),
    ];

    const issues = detectCriticalSlideLayoutIssues(elements);
    const repairedIssues = detectCriticalSlideLayoutIssues(repairSlideElementLayout(elements));

    expect(issues.some((issue) => issue.type === 'legacy-task-grid-layout')).toBe(true);
    expect(repairedIssues.some((issue) => issue.type === 'legacy-task-grid-layout')).toBe(true);
  });
});
