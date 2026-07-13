import { create } from 'zustand';
import { createSelectors } from '@/lib/utils/create-selectors';

export type TourStepId = 1 | 2 | 3 | 4;

export interface TourStepDefinition {
  id: TourStepId;
  targetId: string;
  title: string;
  description: string;
  placement: 'top' | 'right' | 'bottom' | 'left';
}

export const TOUR_STEPS: TourStepDefinition[] = [
  {
    id: 1,
    targetId: 'playback-controls',
    title: 'Playback 节奏讲授',
    description:
      '这里展示 StreamBuffer 如何按时钟节奏顺序播放 AI Speech、Spotlight 和 Laser，覆盖 ICAP 的 P/A 级体验。',
    placement: 'top',
  },
  {
    id: 2,
    targetId: 'debate-whiteboard',
    title: 'Debate Flow 观点对撞',
    description: '看！两位 AI 导师正在辩论。请点击聊天框说出你的判决以体验 Interactive 级互动。',
    placement: 'left',
  },
  {
    id: 3,
    targetId: 'teachback-toolbar',
    title: 'Teach-back Vision 建构',
    description:
      '现在轮到你当小老师了。请在画布上随意涂鸦，并点击发送讲解，系统会把你的板书截图利用 Vision 多模态技术发给 AI 进行建构评估。',
    placement: 'bottom',
  },
  {
    id: 4,
    targetId: 'profile-panel',
    title: 'Learning Profile 闭环',
    description: '你刚才的所有表现，都会被画像引擎转化为长时学习证据，形成跨课时的 ICAP 闭环。',
    placement: 'left',
  },
];

interface TourState {
  isTourActive: boolean;
  currentStep: number;
  completedAt: number | null;
  startTour: () => void;
  endTour: () => void;
  nextStep: () => void;
  previousStep: () => void;
  setStep: (step: number) => void;
}

function clampStep(step: number): number {
  return Math.min(TOUR_STEPS.length, Math.max(1, Math.round(step)));
}

const useTourStoreBase = create<TourState>()((set, get) => ({
  isTourActive: false,
  currentStep: 1,
  completedAt: null,

  startTour: () => {
    const state = get();
    if (state.isTourActive && state.currentStep === 1 && state.completedAt === null) return;
    set({
      isTourActive: true,
      currentStep: 1,
      completedAt: null,
    });
  },

  endTour: () => {
    if (!get().isTourActive) return;
    set({
      isTourActive: false,
      completedAt: Date.now(),
    });
  },

  nextStep: () => {
    const next = get().currentStep + 1;
    if (next > TOUR_STEPS.length) {
      get().endTour();
      return;
    }
    set({ currentStep: next });
  },

  previousStep: () => {
    const next = clampStep(get().currentStep - 1);
    if (next === get().currentStep) return;
    set({ currentStep: next });
  },

  setStep: (step) => {
    const next = clampStep(step);
    if (next === get().currentStep) return;
    set({ currentStep: next });
  },
}));

export const useTourStore = createSelectors(useTourStoreBase);
