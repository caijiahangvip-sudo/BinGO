/**
 * 自动思考强度判断模块
 *
 * 根据当前请求的内容特征，智能选择最合适的思考强度档位。
 * 不是固定值，也不是随机，而是多维特征加权打分后映射到档位。
 * 每次请求都会重新判断，所以"每页变换"——不同输入得到不同强度。
 *
 * 设计目标：在不增加额外 LLM 调用（无延迟、无成本）的前提下，
 * 用启发式特征提取模拟"看一眼就知道这事难不难"的直觉。
 */

import type { UIMessage } from 'ai';

// 实际可执行的思考档位（不含 'auto' 和 'none'，none 由用户显式选择）
export type ResolvedEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * 从对话历史中提取最新一条用户消息文本
 */
function extractLatestUserText(messages: UIMessage[]): string {
  // 从后往前找最后一条用户消息
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    // UIMessage 的内容可能在 content 或 parts 里
    const text =
      (msg as { content?: unknown }).content ?? (msg as { parts?: unknown[] }).parts;
    if (typeof text === 'string') return text;
    if (Array.isArray(text)) {
      // parts 数组，拼接所有 text 类型
      return text
        .map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? ''))
        .join('');
    }
  }
  return '';
}

/**
 * 复杂度特征提取
 * 每个维度返回一个 0~N 的分数，叠加后决定档位
 */
interface ComplexityFeatures {
  lengthScore: number; // 长度分：短问题低分，长问题高分
  codeScore: number; // 代码分：含代码块或编程语境
  mathScore: number; // 数学分：含公式或数学求解
  reasoningScore: number; // 推理分：含"为什么/证明/推导/对比"等
  casualScore: number; // 闲聊分：问候/感谢/简单问答（负向，降低复杂度）
  multiTurnScore: number; // 多轮深度分：长对话延续讨论
}

function extractFeatures(messages: UIMessage[], latestText: string): ComplexityFeatures {
  const text = latestText.toLowerCase();
  const len = latestText.length;

  // —— 长度分 ——
  // < 30 字 → 0；30-120 → 1；120-300 → 2；300-800 → 3；> 800 → 4
  let lengthScore = 0;
  if (len > 800) lengthScore = 4;
  else if (len > 300) lengthScore = 3;
  else if (len > 120) lengthScore = 2;
  else if (len > 30) lengthScore = 1;

  // —— 代码分 ——
  // 含代码块 ```、或编程关键词
  let codeScore = 0;
  if (/```/.test(latestText)) codeScore += 2; // 明确代码块，强信号
  const codeKeywords = /(代码|函数|function|bug|报错|error|实现|implement|算法|algorithm|重构|refactor|接口|api|编译|compile|栈|stack|递归|recursion|数组|array|对象|object)/i;
  if (codeKeywords.test(text)) codeScore += 1;

  // —— 数学分 ——
  // 含 LaTeX 公式、方程、求解
  let mathScore = 0;
  if (/(\$|\\\[|\\\(|\\frac|\\sum|\\int)/.test(latestText)) mathScore += 2; // 公式强信号
  const mathKeywords = /(方程|求解|证明|计算|导数|积分|概率|矩阵|向量|几何|代数|定理|equation|solve|derivative|integral|probability|matrix|theorem)/i;
  if (mathKeywords.test(text)) mathScore += 1;

  // —— 推理分 ——
  // 含复杂推理请求词
  let reasoningScore = 0;
  const reasoningKeywords = /(为什么|为什么|分析|对比|优缺点|利弊|权衡|推导|逻辑|原因|影响|关系|区别|step by step|逐步|方案|策略|权衡|trade.?off|why|reason|compare|analy[sz]e|pros and cons)/i;
  if (reasoningKeywords.test(text)) reasoningScore += 2;
  // 多问号或多次"如何"暗示多层推理
  const questionMarks = (latestText.match(/？|\?/g) ?? []).length;
  if (questionMarks >= 3) reasoningScore += 1;

  // —— 闲聊分（负向） ——
  // 问候、感谢、简单确认
  let casualScore = 0;
  const casualPatterns = /^(你好|您好|hi|hello|hey|谢谢|感谢|thanks|好的|嗯|ok|okay|再见|bye|晚安|早安|哈喽)/i;
  if (casualPatterns.test(text.trim())) casualScore += 2;
  // 极短且无标点堆叠，倾向闲聊
  if (len < 15 && questionMarks === 0) casualScore += 1;

  // —— 多轮深度分 ——
  // 历史消息越多，说明在延续讨论，略提复杂度
  const userTurnCount = messages.filter((m) => m.role === 'user').length;
  let multiTurnScore = 0;
  if (userTurnCount >= 6) multiTurnScore += 2;
  else if (userTurnCount >= 3) multiTurnScore += 1;

  return { lengthScore, codeScore, mathScore, reasoningScore, casualScore, multiTurnScore };
}

/**
 * 把特征总分映射到思考档位
 *
 * 总分 = 长度 + 代码 + 数学 + 推理 + 多轮 - 闲聊
 * 闲聊是负向的，会拉低总分
 */
function scoreToEffort(features: ComplexityFeatures): ResolvedEffort {
  const total =
    features.lengthScore +
    features.codeScore +
    features.mathScore +
    features.reasoningScore +
    features.multiTurnScore -
    features.casualScore;

  // 映射区间（经验阈值，可调）
  if (total <= 1) return 'minimal'; // 闲聊、简单问答
  if (total <= 3) return 'low'; // 简单任务
  if (total <= 5) return 'medium'; // 中等复杂
  if (total <= 7) return 'high'; // 较复杂
  return 'xhigh'; // 高度复杂（长代码 + 数学 + 多层推理）
}

/**
 * 主入口：根据对话内容自动判断思考强度
 *
 * @param messages 完整对话历史
 * @returns 推荐的思考档位，以及判断依据（便于调试/日志）
 */
export function resolveAutoThinkingEffort(messages: UIMessage[]): {
  effort: ResolvedEffort;
  reason: string;
} {
  const latestText = extractLatestUserText(messages);
  const features = extractFeatures(messages, latestText);
  const effort = scoreToEffort(features);

  // 生成人可读的判断依据
  const drivers: string[] = [];
  if (features.codeScore > 0) drivers.push('含代码');
  if (features.mathScore > 0) drivers.push('含数学');
  if (features.reasoningScore > 0) drivers.push('需推理');
  if (features.casualScore > 0) drivers.push('偏闲聊');
  if (features.multiTurnScore > 0) drivers.push('多轮讨论');
  if (features.lengthScore >= 3) drivers.push('长输入');
  const reason = drivers.length > 0 ? drivers.join('、') : '常规请求';

  return { effort, reason };
}
