import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.ICC_BASE_URL || 'http://localhost:3002';
const outDir = path.resolve(process.cwd(), '..', 'icc-screenshots');
const stageId = 'icc-linear-function-demo';
const topic = '用 AI 讲解初中数学中的一次函数';

const shots = [
  ['homepage.png', 'Bingo home page with the topic/document entry area.'],
  ['topic-input.png', 'Home page after entering the demo topic.'],
  ['course-outline.png', 'Generated course structure shown in the classroom scene list and outline slide.'],
  ['classroom-main.png', 'Core classroom view with slide, AI teacher/student roundtable, and chat panel.'],
  ['whiteboard-demo.png', 'Whiteboard overlay with formula derivation and graph annotations.'],
  ['quiz-demo.png', 'Knowledge check quiz for linear-function concepts.'],
  ['interactive-demo.png', 'Interactive HTML simulation for adjusting slope and intercept.'],
  ['export-demo.png', 'Classroom export menu for PPTX and reusable teaching resource package.'],
  ['settings-model.png', 'Model, TTS/ASR, PDF, and vector service settings dialog.'],
  ['agents-discussion.png', 'AI teacher, assistant, and student multi-agent classroom discussion area.'],
  ['pbl-activity.png', 'Project-based learning activity workspace for planning a taxi-fare model.'],
  ['generated-ppt.png', 'Generated slide deck preview in the classroom sidebar and slide canvas.'],
  ['generated-html.png', 'Generated interactive HTML classroom page preview.'],
];

function text(id, content, left, top, width, height, size = 28, color = '#111827', bold = false) {
  return {
    id,
    type: 'text',
    content: `<p style="font-size:${size}px;line-height:1.28;color:${color};font-weight:${bold ? 700 : 400};">${content}</p>`,
    left,
    top,
    width,
    height,
    rotate: 0,
    defaultFontName: 'Helvetica Now Display',
    defaultColor: color,
  };
}

function shape(id, left, top, width, height, fill, radius = 24) {
  return {
    id,
    type: 'shape',
    viewBox: [1000, 1000],
    path: 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z',
    left,
    top,
    width,
    height,
    rotate: 0,
    fill,
    fixedRatio: false,
    radius,
  };
}

function line(id, x1, y1, x2, y2, color = '#2563eb', width = 4, points = ['', 'arrow']) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return {
    id,
    type: 'line',
    left,
    top,
    width,
    start: [x1 - left, y1 - top],
    end: [x2 - left, y2 - top],
    style: 'solid',
    color,
    points,
  };
}

function latex(id, latex, left, top, width, height, color = '#111827') {
  return {
    id,
    type: 'latex',
    latex,
    left,
    top,
    width,
    height,
    rotate: 0,
    fixedRatio: false,
    color,
  };
}

function slide(id, elements, background = '#f8fafc') {
  return {
    id,
    viewportSize: 1000,
    viewportRatio: 0.5625,
    theme: {
      backgroundColor: background,
      themeColors: ['#2563eb', '#16a34a', '#f59e0b', '#7c3aed'],
      fontColor: '#111827',
      fontName: 'Helvetica Now Display',
    },
    background: { type: 'solid', color: background },
    elements,
  };
}

const coverSlide = slide('slide-cover', [
  shape('cover-band', 0, 0, 1000, 562.5, '#eef6ff'),
  shape('cover-card', 70, 86, 430, 310, '#ffffff'),
  text('cover-kicker', 'AI 生成课堂 / 初中数学', 105, 120, 340, 42, 22, '#2563eb', true),
  text('cover-title', '一次函数：从图像到应用', 105, 174, 360, 120, 43, '#0f172a', true),
  text('cover-sub', '主题：用 AI 讲解初中数学中的一次函数', 108, 306, 330, 72, 20, '#475569'),
  line('cover-x', 580, 410, 900, 410, '#334155', 3),
  line('cover-y', 640, 450, 640, 120, '#334155', 3),
  line('cover-f', 610, 380, 890, 180, '#2563eb', 7),
  text('cover-formula', 'y = kx + b', 690, 145, 180, 54, 30, '#2563eb', true),
  shape('cover-dot1', 634, 355, 16, 16, '#f59e0b'),
  shape('cover-dot2', 814, 227, 16, 16, '#f59e0b'),
]);

const outlineSlide = slide('slide-outline', [
  text('outline-title', '课堂大纲', 64, 44, 340, 56, 38, '#0f172a', true),
  text('outline-topic', '围绕 “一次函数” 自动生成 5 个教学环节', 66, 102, 520, 40, 21, '#475569'),
  ...[
    ['1', '情境导入', '出租车计费、气温变化等生活场景'],
    ['2', '概念建立', '理解 y = kx + b 中 k 与 b 的含义'],
    ['3', '图像探索', '拖动参数观察直线变化'],
    ['4', '即时测验', '判断斜率、截距和函数表达式'],
    ['5', '项目任务', '设计一个校园小卖部利润模型'],
  ].flatMap(([n, title, desc], i) => [
    shape(`outline-card-${n}`, 78, 166 + i * 66, 800, 48, i % 2 ? '#f1f5f9' : '#ffffff'),
    shape(`outline-dot-${n}`, 100, 178 + i * 66, 25, 25, '#2563eb'),
    text(`outline-num-${n}`, n, 107, 181 + i * 66, 18, 20, 14, '#ffffff', true),
    text(`outline-title-${n}`, title, 145, 171 + i * 66, 150, 30, 21, '#111827', true),
    text(`outline-desc-${n}`, desc, 300, 173 + i * 66, 520, 30, 18, '#64748b'),
  ]),
]);

const lectureSlide = slide('slide-lecture', [
  text('lecture-title', '一次函数的图像与意义', 58, 42, 460, 52, 36, '#0f172a', true),
  text('lecture-caption', 'AI 教师正在讲解：k 决定倾斜程度，b 决定与 y 轴交点。', 60, 96, 660, 34, 20, '#475569'),
  line('lecture-x', 104, 444, 530, 444, '#334155', 3),
  line('lecture-y', 170, 480, 170, 130, '#334155', 3),
  line('lecture-f1', 142, 405, 490, 176, '#2563eb', 6),
  line('lecture-f2', 150, 218, 500, 362, '#16a34a', 5),
  text('lecture-blue', 'k > 0：随 x 增大而增大', 570, 170, 330, 44, 24, '#2563eb', true),
  text('lecture-green', 'k < 0：随 x 增大而减小', 570, 236, 330, 44, 24, '#16a34a', true),
  latex('lecture-formula', 'y = kx + b', 594, 322, 250, 70, '#111827'),
  text('lecture-note', '课堂消息：AI 同学提问 “b 改变时直线为什么整体上下移动？”', 570, 410, 360, 60, 19, '#7c3aed'),
]);

const whiteboard = slide('whiteboard-1', [
  text('wb-title', '板书推导：由两点求一次函数', 70, 54, 560, 48, 32, '#111827', true),
  text('wb-step1', '已知 A(0, 2), B(3, 8)', 88, 135, 360, 42, 27, '#0f172a'),
  latex('wb-k', 'k=\\frac{8-2}{3-0}=2', 88, 196, 260, 58, '#2563eb'),
  latex('wb-b', 'b=2', 88, 270, 140, 52, '#16a34a'),
  latex('wb-y', 'y=2x+2', 88, 340, 230, 64, '#dc2626'),
  line('wb-x', 500, 430, 880, 430, '#334155', 3),
  line('wb-y-axis', 560, 462, 560, 120, '#334155', 3),
  line('wb-f', 560, 360, 820, 186, '#dc2626', 6),
  shape('wb-a', 551, 351, 18, 18, '#2563eb'),
  shape('wb-bp', 758, 213, 18, 18, '#2563eb'),
  text('wb-label-a', 'A(0,2)', 575, 348, 90, 26, 17, '#2563eb', true),
  text('wb-label-b', 'B(3,8)', 780, 210, 90, 26, 17, '#2563eb', true),
]);

const generatedSlide = slide('slide-generated-ppt', [
  text('ppt-title', '生成后的 PPT 预览', 60, 42, 440, 52, 36, '#0f172a', true),
  shape('ppt-thumb1', 80, 130, 220, 124, '#dbeafe'),
  shape('ppt-thumb2', 340, 130, 220, 124, '#dcfce7'),
  shape('ppt-thumb3', 600, 130, 220, 124, '#fef3c7'),
  text('ppt-t1', '概念', 142, 171, 90, 34, 26, '#1d4ed8', true),
  text('ppt-t2', '图像', 402, 171, 90, 34, 26, '#15803d', true),
  text('ppt-t3', '练习', 662, 171, 90, 34, 26, '#b45309', true),
  text('ppt-desc', '课堂内容可导出为 PPTX，也可以打包交互 HTML 作为教学资源包复用。', 86, 318, 760, 72, 26, '#334155'),
  line('ppt-flow1', 300, 190, 340, 190, '#64748b', 3),
  line('ppt-flow2', 560, 190, 600, 190, '#64748b', 3),
]);

const interactiveHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
body{font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0;height:100vh;display:grid;grid-template-columns:300px 1fr;gap:24px;padding:32px;box-sizing:border-box}
.panel{background:white;border:1px solid #e2e8f0;border-radius:18px;padding:22px;box-shadow:0 18px 40px rgba(15,23,42,.08)}
h1{font-size:26px;margin:0 0 10px}.formula{font-size:34px;color:#2563eb;font-weight:800;margin:16px 0}.ctrl{margin:20px 0}label{font-size:14px;color:#475569;font-weight:700;display:flex;justify-content:space-between}input{width:100%;accent-color:#2563eb}svg{width:100%;height:100%;background:white;border-radius:18px;border:1px solid #e2e8f0}.grid{stroke:#e2e8f0}.axis{stroke:#334155;stroke-width:2}.line{stroke:#2563eb;stroke-width:5}.point{fill:#f59e0b}.note{font-size:15px;color:#64748b;line-height:1.6}
</style>
</head>
<body>
<section class="panel">
<h1>交互实验：改变 k 与 b</h1>
<p class="note">拖动滑块观察直线如何旋转和上下平移。</p>
<div class="formula">y = <span id="kText">2</span>x + <span id="bText">1</span></div>
<div class="ctrl"><label>斜率 k <span id="kVal">2</span></label><input id="k" type="range" min="-3" max="3" step="0.5" value="2"></div>
<div class="ctrl"><label>截距 b <span id="bVal">1</span></label><input id="b" type="range" min="-4" max="4" step="0.5" value="1"></div>
<p class="note">k 越大，直线越陡；b 改变时，直线与 y 轴的交点同步移动。</p>
</section>
<svg viewBox="0 0 700 500">
<g id="grid"></g><line class="axis" x1="60" y1="250" x2="650" y2="250"/><line class="axis" x1="350" y1="40" x2="350" y2="460"/>
<line id="line" class="line" x1="0" y1="0" x2="0" y2="0"/><circle id="dot" class="point" r="8"/><text id="label" x="380" y="90" font-size="20" fill="#2563eb" font-weight="700"></text>
</svg>
<script>
const grid=document.getElementById('grid'); for(let x=60;x<=650;x+=50)grid.innerHTML+=\`<line class="grid" x1="\${x}" y1="40" x2="\${x}" y2="460"/>\`; for(let y=50;y<=450;y+=50)grid.innerHTML+=\`<line class="grid" x1="60" y1="\${y}" x2="650" y2="\${y}"/>\`;
const k=document.getElementById('k'), b=document.getElementById('b'), line=document.getElementById('line'), dot=document.getElementById('dot'), label=document.getElementById('label');
function map(x,y){return [350+x*50,250-y*50]} function draw(){const kv=Number(k.value), bv=Number(b.value); kVal.textContent=kText.textContent=kv; bVal.textContent=bText.textContent=bv; const p1=map(-5,kv*-5+bv), p2=map(5,kv*5+bv), p0=map(0,bv); line.setAttribute('x1',p1[0]);line.setAttribute('y1',p1[1]);line.setAttribute('x2',p2[0]);line.setAttribute('y2',p2[1]);dot.setAttribute('cx',p0[0]);dot.setAttribute('cy',p0[1]);label.textContent='截距 b = '+bv; label.setAttribute('x',p0[0]+14); label.setAttribute('y',p0[1]-12)} k.oninput=b.oninput=draw; draw();
</script>
</body>
</html>`;

const scenes = [
  {
    id: 'scene-outline',
    stageId,
    type: 'slide',
    title: '课堂大纲',
    order: 0,
    content: { type: 'slide', canvas: outlineSlide },
    actions: [{ id: 'speech-outline', type: 'speech', agentId: 'icc-teacher', text: '我们先看本节课的结构，从生活情境进入一次函数。' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'scene-lecture',
    stageId,
    type: 'slide',
    title: '核心讲解',
    order: 1,
    content: { type: 'slide', canvas: lectureSlide },
    actions: [
      { id: 'speech-main', type: 'speech', agentId: 'icc-teacher', text: '一次函数可以写成 y 等于 kx 加 b。k 决定方向和陡峭程度，b 决定截距。' },
      { id: 'discussion-main', type: 'discussion', agentId: 'icc-student', topic: 'b 改变时图像会发生什么？', prompt: '请比较 y=2x+1 和 y=2x+3 的图像。' },
    ],
    multiAgent: { enabled: true, agentIds: ['icc-teacher', 'icc-assistant', 'icc-student'] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'scene-whiteboard',
    stageId,
    type: 'slide',
    title: '白板推导',
    order: 2,
    content: { type: 'slide', canvas: whiteboard },
    actions: [{ id: 'speech-wb', type: 'speech', agentId: 'icc-teacher', text: '现在用两点法推导函数解析式。' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'scene-quiz',
    stageId,
    type: 'quiz',
    title: '即时测验',
    order: 3,
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          type: 'single',
          question: '函数 y = 2x + 3 中，斜率 k 是多少？',
          options: [
            { value: 'A', label: '2' },
            { value: 'B', label: '3' },
            { value: 'C', label: '-2' },
            { value: 'D', label: '无法确定' },
          ],
          answer: ['A'],
          analysis: '一次函数 y = kx + b 中，x 的系数就是斜率 k。',
          points: 1,
        },
        {
          id: 'q2',
          type: 'single',
          question: '当 b 从 1 变为 4，直线 y = 2x + b 会怎样变化？',
          options: [
            { value: 'A', label: '整体向上平移' },
            { value: 'B', label: '整体向下平移' },
            { value: 'C', label: '变得更陡' },
            { value: 'D', label: '与 x 轴重合' },
          ],
          answer: ['A'],
          analysis: 'b 是 y 轴截距，变大时图像整体向上移动。',
          points: 1,
        },
      ],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'scene-interactive',
    stageId,
    type: 'interactive',
    title: '交互实验',
    order: 4,
    content: { type: 'interactive', url: 'about:blank', html: interactiveHtml },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'scene-pbl',
    stageId,
    type: 'pbl',
    title: 'PBL 项目活动',
    order: 5,
    content: {
      type: 'pbl',
      projectConfig: {
        selectedRole: '建模组长',
        projectInfo: {
          title: '设计校园小卖部利润模型',
          description: '用一次函数描述销量、成本、收入和利润之间的关系。',
        },
        agents: [
          { name: '任务经理', actor_role: '拆解任务与排期', role_division: 'management', system_prompt: '', default_mode: 'issueboard', delay_time: 0, env: {}, is_user_role: false, is_active: true, is_system_agent: false },
          { name: '数据分析员', actor_role: '整理表格并建立函数', role_division: 'development', system_prompt: '', default_mode: 'issueboard', delay_time: 0, env: {}, is_user_role: false, is_active: true, is_system_agent: false },
          { name: '建模组长', actor_role: '选择方案并汇报', role_division: 'management', system_prompt: '', default_mode: 'issueboard', delay_time: 0, env: {}, is_user_role: true, is_active: true, is_system_agent: false },
        ],
        issueboard: {
          agent_ids: ['任务经理', '数据分析员', '建模组长'],
          current_issue_id: 'issue-1',
          issues: [
            { id: 'issue-1', title: '确定变量与假设', description: '明确单价、固定成本、销量等变量。', person_in_charge: '建模组长', participants: ['任务经理', '数据分析员'], notes: '把利润写成 P=收入-成本。', parent_issue: null, index: 1, is_done: false, is_active: true, generated_questions: '哪些量是不变的？哪些量会随着销量变化？', question_agent_name: '任务经理', judge_agent_name: 'AI 教师' },
            { id: 'issue-2', title: '建立一次函数', description: '写出 P = ax + b，并解释 a、b。', person_in_charge: '数据分析员', participants: ['建模组长'], notes: '', parent_issue: null, index: 2, is_done: false, is_active: false, generated_questions: '斜率代表每多卖一件增加的利润吗？', question_agent_name: '数据分析员', judge_agent_name: 'AI 教师' },
            { id: 'issue-3', title: '制作汇报页', description: '把函数、图像和结论做成课堂展示。', person_in_charge: '建模组长', participants: ['任务经理'], notes: '', parent_issue: null, index: 3, is_done: false, is_active: false, generated_questions: '怎样让同学看懂截距的意义？', question_agent_name: '任务经理', judge_agent_name: 'AI 教师' },
          ],
        },
        chat: {
          messages: [
            { id: 'pbl-msg-1', agent_name: '任务经理', message: '我们先把固定成本设为 b，把每件商品带来的利润增量设为 k。', timestamp: Date.now(), read_by: [] },
            { id: 'pbl-msg-2', agent_name: '数据分析员', message: '如果每卖一份文具净赚 2 元，摊位固定成本是 30 元，那么 P=2x-30。', timestamp: Date.now(), read_by: [] },
          ],
        },
      },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'scene-generated-ppt',
    stageId,
    type: 'slide',
    title: '导出预览',
    order: 6,
    content: { type: 'slide', canvas: generatedSlide },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const agents = [
  { id: 'icc-teacher', stageId, name: 'AI 数学教师', role: 'teacher', persona: '循序渐进讲解初中数学概念。', avatar: '/avatars/teacher.png', color: '#2563eb', priority: 1, createdAt: Date.now() },
  { id: 'icc-assistant', stageId, name: '课堂助教', role: 'assistant', persona: '整理板书、提示易错点。', avatar: '/avatars/assist.png', color: '#16a34a', priority: 2, createdAt: Date.now() },
  { id: 'icc-student', stageId, name: '好奇同学', role: 'student', persona: '提出学生常见疑问。', avatar: '/avatars/curious.png', color: '#f59e0b', priority: 3, createdAt: Date.now() },
];

const stage = {
  id: stageId,
  name: topic,
  description: 'ICC screenshot demo classroom',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  language: 'zh-CN',
  style: 'professional',
  currentSceneId: 'scene-outline',
  agentIds: agents.map((a) => a.id),
  generatedAgentConfigs: agents.map(({ stageId: _stageId, createdAt: _createdAt, ...agent }) => agent),
  whiteboard: [whiteboard],
};

async function waitForApp(page) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}

async function seedDemo(page) {
  await page.evaluate(async ({ stage, scenes, agents, stageId }) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('MAIC-Database');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction(['stages', 'scenes', 'stageOutlines', 'generatedAgents'], 'readwrite');
    await Promise.all([
      new Promise((resolve, reject) => {
        const store = tx.objectStore('scenes');
        const index = store.index('stageId');
        const req = index.openCursor(IDBKeyRange.only(stageId));
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve();
          cursor.delete();
          cursor.continue();
        };
      }),
      new Promise((resolve, reject) => {
        const store = tx.objectStore('generatedAgents');
        const index = store.index('stageId');
        const req = index.openCursor(IDBKeyRange.only(stageId));
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve();
          cursor.delete();
          cursor.continue();
        };
      }),
    ]);
    tx.objectStore('stages').put(stage);
    scenes.forEach((scene) => tx.objectStore('scenes').put(scene));
    agents.forEach((agent) => tx.objectStore('generatedAgents').put(agent));
    tx.objectStore('stageOutlines').put({
      stageId,
      outlines: scenes.map((scene) => ({ id: `outline-${scene.id}`, title: scene.title, type: scene.type, order: scene.order })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem('settings-storage', JSON.stringify({
      state: {
        selectedAgentIds: ['icc-teacher', 'icc-assistant', 'icc-student'],
        agentMode: 'auto',
        chatAreaCollapsed: false,
        sidebarCollapsed: false,
        ttsEnabled: true,
        asrEnabled: true,
      },
      version: 0,
    }));
  }, { stage, scenes, agents, stageId });
}

async function screenshot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
}

async function goScene(page, sceneId) {
  await page.goto(`${baseURL}/classroom/${stageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="scene-list"]', { timeout: 30000 });
  await page.evaluate((id) => {
    const request = indexedDB.open('MAIC-Database');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('stages', 'readwrite');
      const get = tx.objectStore('stages').get('icc-linear-function-demo');
      get.onsuccess = () => {
        const record = get.result;
        record.currentSceneId = id;
        record.updatedAt = Date.now();
        tx.objectStore('stages').put(record);
      };
    };
  }, sceneId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="scene-list"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function clickIconButton(page, iconClass, index = 0) {
  const buttons = page.locator(`button:has(svg.${iconClass})`);
  await buttons.nth(index).click();
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  await waitForApp(page);
  await screenshot(page, 'homepage.png');

  const textarea = page.locator('textarea').first();
  await textarea.fill(topic);
  await screenshot(page, 'topic-input.png');

  await seedDemo(page);

  await goScene(page, 'scene-outline');
  await screenshot(page, 'course-outline.png');

  await goScene(page, 'scene-lecture');
  await screenshot(page, 'classroom-main.png');
  await screenshot(page, 'agents-discussion.png');

  await goScene(page, 'scene-whiteboard');
  await screenshot(page, 'whiteboard-demo.png');

  await goScene(page, 'scene-quiz');
  await page.getByRole('button').filter({ hasText: /开始|Start|Start Quiz/i }).first().click().catch(async () => {
    await page.locator('button').filter({ hasText: /Start|开始/ }).first().click();
  });
  await page.waitForTimeout(800);
  await screenshot(page, 'quiz-demo.png');

  await goScene(page, 'scene-interactive');
  await screenshot(page, 'interactive-demo.png');
  await screenshot(page, 'generated-html.png');

  await goScene(page, 'scene-pbl');
  await screenshot(page, 'pbl-activity.png');

  await goScene(page, 'scene-generated-ppt');
  await screenshot(page, 'generated-ppt.png');

  await clickIconButton(page, 'lucide-download');
  await page.waitForTimeout(500);
  await screenshot(page, 'export-demo.png');

  await clickIconButton(page, 'lucide-settings');
  await page.waitForTimeout(800);
  await screenshot(page, 'settings-model.png');

  const readme = [
    '# ICC Screenshots',
    '',
    `Generated from the local Bingo Next.js app at ${baseURL}.`,
    '',
    ...shots.map(([file, desc]) => `- \`${file}\`: ${desc}`),
    '',
    'Demo topic: 用 AI 讲解初中数学中的一次函数',
  ].join('\n');
  await fs.writeFile(path.join(outDir, 'README.md'), readme, 'utf8');
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
