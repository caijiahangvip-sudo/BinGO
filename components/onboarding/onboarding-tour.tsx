'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Hand,
  UserPlus,
  Users,
  Home,
  Presentation,
  PencilRuler,
  ScanText,
  ListChecks,
  BookOpen,
  Brain,
  RefreshCw,
  CircleHelp,
  CheckCircle2,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'bingo.hasSeenOnboarding';
const OPEN_EVENT = 'bingo:open-onboarding';

export function openOnboardingTour() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface OnboardingPage {
  icon: LucideIcon;
  color: string;
  title: string;
  paragraphs: string[];
}

const PAGES: OnboardingPage[] = [
  {
    icon: Hand,
    color: 'text-blue-500',
    title: '欢迎来到 BinGO',
    paragraphs: [
      'BinGO 是你的学习小助手。老师布置的学习目标、练习和作业会发到你的电脑上，你完成的作品也可以直接交给老师批改。',
      '这套系统一共有三个部分：你正在用的学生端、老师用的教师端、还有学校管理员用的后台。你只需要学会用学生端就够了。',
      '你的账号和学习数据可以保存在服务器上，所以就算换一台电脑，只要登录同一个账号，内容都还在。',
      '接下来花一两分钟，跟着这几页了解一下怎么用。以后也可以在「设置 → 常规 → 新手教程」里随时重新看。',
    ],
  },
  {
    icon: UserPlus,
    color: 'text-orange-500',
    title: '第一步：注册和登录',
    paragraphs: [
      '第一次使用，需要先有一个账号。打开「设置」，找到「服务器与账号」一栏。',
      '注册方法：① 点「注册」；② 输入老师给你的「邀请码」；③ 设置你自己的用户名和密码，就完成啦。',
      '邀请码要找老师或管理员领取。如果提示邀请码不对或已过期，告诉老师，老师会换一个新的给你。',
      '已经有账号的同学，直接输入用户名和密码登录就可以。',
      '小提醒：密码要字母加数字组合，不要告诉同学，也不要写在便签上贴在屏幕边。',
    ],
  },
  {
    icon: Users,
    color: 'text-green-500',
    title: '第二步：加入班级',
    paragraphs: [
      '登录之后最重要的一件事：加入你的班级。',
      '在「服务器与账号」或「学习网络」入口里，输入老师发的班级邀请码，点「加入班级」。看到班级名字出现，就说明加入成功了。',
      '只有加入班级之后，老师发布的学习目标、练习和测评才会送到你的电脑上，千万不要跳过这一步。',
      '还可以输入小组邀请码，加入「学习小组」，和同学一起完成任务、讨论问题。',
    ],
  },
  {
    icon: Home,
    color: 'text-blue-500',
    title: '首页：从这里开始',
    paragraphs: [
      '打开应用最先看到的就是「首页」。',
      '首页可以上传 PDF 课件或试卷，让 AI 帮你生成一节互动课堂；也能看到你最近的学习内容。',
      '每天开始学习前，先在首页确认今天要做哪些任务，做完一项就少一项。',
      '如果页面提示服务器离线，先检查电脑的网络是不是连接正常。',
    ],
  },
  {
    icon: Presentation,
    color: 'text-purple-500',
    title: '课堂：和 AI 角色一起学',
    paragraphs: [
      '「课堂」是 BinGO 最有特色的功能：一份课件会变成一节有 AI 角色参与的互动课。',
      '课堂上会有不同的 AI 角色（比如讲师、同学）讲解内容、向你提问，你也可以随时发言。',
      '回答问题不用紧张，说错了 AI 也会耐心解释，这正是练习的好机会。',
      '上课时可以跟着页面上的提示一步一步走，走完一节课就算完成。',
    ],
  },
  {
    icon: PencilRuler,
    color: 'text-pink-500',
    title: '白板：你的草稿纸',
    paragraphs: [
      '「白板」就像一张用不完的草稿纸。',
      '数学演算、画思维导图、随手记灵感，都可以用鼠标或手写笔在上面写画。',
      '白板内容会保存在你的账号里，换设备登录也能找回来，不用拍照备份。',
    ],
  },
  {
    icon: ScanText,
    color: 'text-teal-500',
    title: 'PDF 与扫描：把纸搬进电脑',
    paragraphs: [
      '纸质练习册、试卷上的题目，可以拍照或扫描成 PDF 导入进来。',
      'OCR 的意思是「文字识别」：软件会把图片里的文字认出来，变成可以复制、可以搜索的文字。',
      '拍照时注意：光线亮一点、纸放平、镜头正对纸面，识别会更准。',
      '导入的 PDF 可以直接用来生成课堂，也可以保存下来以后复习。',
    ],
  },
  {
    icon: ListChecks,
    color: 'text-red-500',
    title: '作业：按时提交',
    paragraphs: [
      '「作业」里是老师布置给你的任务列表。',
      '点进一个任务，可以看到老师的要求和截止时间，完成后按页面提示提交你的成果。',
      '提交之后老师就能看到并批改，批改结果也会返回到这里，记得回来看老师的评语。',
      '如果有 AI 评分建议，它只负责给参考意见，最终成绩由老师决定。',
    ],
  },
  {
    icon: BookOpen,
    color: 'text-amber-600',
    title: '书本学习',
    paragraphs: [
      '「书本课堂」和「书本练习」用来跟着教材学习。',
      '把课本内容导进来之后，可以按章节阅读、做练习，安排自己的学习进度。',
      '配合白板和 PDF 导入，可以把书上的重点整理成自己的学习资料。',
    ],
  },
  {
    icon: Brain,
    color: 'text-indigo-500',
    title: '学习工具：AI 小帮手',
    paragraphs: [
      '应用里还有 AI 学习功能，比如讲解题目、练习对话等。',
      '使用小原则：AI 是来帮你「学会」的，不是替你「做完」的。先自己思考，再问 AI，效果最好。',
      'AI 的回答偶尔也会出错，重要内容要和课本、老师讲的核对一下。',
      'AI 服务一般由老师或管理员提前配置好，如果提示没有可用的 AI，告诉老师就可以。',
    ],
  },
  {
    icon: RefreshCw,
    color: 'text-green-600',
    title: '同步：数据不怕丢',
    paragraphs: [
      '登录账号后，设置和学习资料会同步到服务器，一般不用你操心。',
      '想立刻同步：打开「设置 → 服务器与账号」，点「立即同步」，下面会显示上一次同步的结果。',
      '换电脑或重装应用时，只要重新登录账号，数据就会下载回来。',
      '在设备列表里能看到你的账号登录了哪些设备；不用的设备点「撤销」把它踢下线。',
      '注意：如果两台设备同时离线改同一份内容，后同步的会覆盖先同步的。重要修改完记得及时联网同步。',
    ],
  },
  {
    icon: CircleHelp,
    color: 'text-gray-500',
    title: '遇到问题怎么办',
    paragraphs: [
      '忘记密码：找老师或管理员帮你重置，不要自己乱试太多次。',
      '收不到老师的任务：先确认已经加入班级，再到「设置 → 服务器与账号」点一次「立即同步」。',
      '邀请码失效：邀请码会定期更换，找老师要最新的。',
      '页面卡住或显示不正常：先刷新页面（客户端可以完全退出再打开），一般就好了。',
      '网络不好时：已下载到本地的内容照样能看，联网后数据会自动补同步。',
      '其他解决不了的问题：直接告诉老师，老师会联系管理员处理。',
    ],
  },
];

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {}
    setOpen(false);
    setPageIndex(0);
  }, []);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {}
    const handler = () => {
      setPageIndex(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  const page = PAGES[pageIndex];
  const isLast = pageIndex === PAGES.length - 1;
  const Icon = page.icon;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish();
      }}
    >
      <DialogContent className="sm:max-w-[680px] max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogTitle className="sr-only">新手教程</DialogTitle>
        <DialogDescription className="sr-only">BinGO 学生端新手引导</DialogDescription>
        <div className="flex justify-end px-4 pt-3">
          {!isLast && (
            <Button variant="ghost" size="sm" onClick={finish}>
              跳过
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-8 pb-4">
          <div className="mx-auto max-w-[560px] flex flex-col items-center gap-5">
            <Icon className={cn('w-16 h-16', page.color)} strokeWidth={1.4} />
            <h2 className="text-2xl font-bold text-center">{page.title}</h2>
            <div className="w-full flex flex-col gap-3">
              {page.paragraphs.map((paragraph) => (
                <div key={paragraph} className="flex items-start gap-2.5">
                  <CheckCircle2 className={cn('w-4 h-4 mt-1 shrink-0', page.color)} />
                  <p className="text-sm leading-relaxed">{paragraph}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <div className="flex gap-1.5">
            {PAGES.map((item, index) => (
              <span
                key={item.title}
                className={cn(
                  'w-2 h-2 rounded-full transition-colors',
                  index === pageIndex ? 'bg-primary' : 'bg-muted-foreground/25',
                )}
              />
            ))}
          </div>
          <Button
            onClick={() => {
              if (isLast) {
                finish();
              } else {
                setPageIndex((value) => value + 1);
              }
            }}
          >
            {isLast ? '开始使用' : '下一步'}
            {!isLast && <ChevronRight className="w-4 h-4 ml-1" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
