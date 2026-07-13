'use client';

import katex from 'katex';
import { cn } from '@/lib/utils';
import { convertHomeworkMathToLatex, segmentHomeworkText } from '@/lib/homework/math-rendering';

interface HomeworkMathTextProps {
  text: string;
  className?: string;
  paragraphClassName?: string;
}

function renderMathHtml(value: string): string {
  return katex.renderToString(convertHomeworkMathToLatex(value), {
    throwOnError: false,
    displayMode: false,
    output: 'html',
  });
}

const INLINE_TOKEN_SPLIT_REGEX = /(\s+|[=＝;；,+＋×÷:：,，()（）[\]【】［］{}｛｝])/;

function splitMathForWrapping(value: string): Array<{ type: 'text' | 'math'; value: string }> {
  if (!/[=＝;；,+＋×÷:：,，()（）[\]【】［］{}｛｝\s]/.test(value)) {
    return [{ type: 'math', value }];
  }

  return value
    .split(INLINE_TOKEN_SPLIT_REGEX)
    .filter(Boolean)
    .map((part) =>
      INLINE_TOKEN_SPLIT_REGEX.test(part)
        ? { type: 'text' as const, value: part }
        : { type: 'math' as const, value: part },
    );
}

function HomeworkMathInline({ value }: { value: string }) {
  return (
    <span
      className="mx-0.5 inline-block align-middle [&_.katex-display]:!m-0"
      dangerouslySetInnerHTML={{ __html: renderMathHtml(value) }}
    />
  );
}

export function HomeworkMathText({
  text,
  className,
  paragraphClassName,
}: HomeworkMathTextProps) {
  const paragraphs = text.split('\n');

  return (
    <div className={cn('space-y-1.5', className)}>
      {paragraphs.map((paragraph, paragraphIndex) => {
        if (!paragraph) {
          return <div key={`blank-${paragraphIndex}`} className="h-2" />;
        }

        const segments = segmentHomeworkText(paragraph);

        return (
          <p
            key={`paragraph-${paragraphIndex}`}
            className={cn('whitespace-pre-wrap break-words', paragraphClassName)}
          >
            {segments.map((segment, segmentIndex) => {
              if (segment.type === 'text') {
                return (
                  <span key={`text-${paragraphIndex}-${segmentIndex}`}>{segment.value}</span>
                );
              }

              return splitMathForWrapping(segment.value).map((part, partIndex) =>
                part.type === 'text' ? (
                  <span key={`math-text-${paragraphIndex}-${segmentIndex}-${partIndex}`}>
                    {part.value}
                  </span>
                ) : (
                  <HomeworkMathInline
                    key={`math-${paragraphIndex}-${segmentIndex}-${partIndex}`}
                    value={part.value}
                  />
                ),
              );
            })}
          </p>
        );
      })}
    </div>
  );
}
