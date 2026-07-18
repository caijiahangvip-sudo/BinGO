'use client'; // 客户端组件

import { useSettingsStore } from '@/lib/store/settings'; // 设置 store
import { Brain } from 'lucide-react'; // 大脑图标

// 思考强度档位定义：值 + 短标签 + 说明
// auto = 智能自动，每次根据请求内容动态判断；其余为固定档位
const EFFORT_OPTIONS: ReadonlyArray<{
  value: 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  label: string;
  desc: string;
}> = [
  { value: 'auto', label: '自动', desc: '根据每次提问内容智能判断思考深度' },
  { value: 'none', label: '关闭', desc: '不启用思考，速度最快' },
  { value: 'minimal', label: '极简', desc: '极少量思考，快速响应' },
  { value: 'low', label: '低', desc: '轻度思考' },
  { value: 'medium', label: '中', desc: '平衡速度与深度' },
  { value: 'high', label: '高', desc: '较深思考' },
  { value: 'xhigh', label: '超高', desc: '最深思考，质量最高但最慢' },
];

// Apple 风格分段控件：水平胶囊容器，选中段填充品牌蓝，未选中段透明
export function ThinkingSelector() {
  const thinkingEffort = useSettingsStore((s) => s.thinkingEffort); // 当前思考强度
  const setThinkingEffort = useSettingsStore((s) => s.setThinkingEffort); // 设置思考强度

  return (
    <div className="flex flex-col gap-2">
      {/* 标签行：图标 + 标题 + 当前档位说明 */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Brain className="size-3.5 text-muted-foreground" />
          思考程度
        </span>
        <span className="text-[11px] text-muted-foreground">
          {EFFORT_OPTIONS.find((o) => o.value === thinkingEffort)?.desc}
        </span>
      </div>

      {/* Apple 分段控件：胶囊容器 + 等宽分段 */}
      <div
        role="radiogroup"
        aria-label="思考程度"
        className="grid grid-cols-7 gap-0.5 rounded-[10px] bg-muted/60 p-0.5"
      >
        {EFFORT_OPTIONS.map((opt) => {
          const active = opt.value === thinkingEffort; // 是否选中
          const isAuto = opt.value === 'auto'; // 自动档特殊样式
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setThinkingEffort(opt.value)}
              className={[
                'h-8 rounded-[8px] text-[12px] font-medium transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                active
                  ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_3px_-1px_rgba(0,0,0,0.05)]'
                  : isAuto
                    ? 'text-primary/90 hover:bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
              ].join(' ')}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/80">仅对支持思考的模型生效</p>
    </div>
  );
}
