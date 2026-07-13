import { test, expect } from '../../e2e/fixtures/base';
import { createSettingsStorage } from '../../e2e/fixtures/test-data/settings';
import { defaultTheme } from '../../e2e/fixtures/test-data/scene-content';

const TEST_STAGE_ID = 'e2e-teach-back-vision-stage';
const SETTINGS_STORAGE = createSettingsStorage({
  sidebarCollapsed: false,
  ttsEnabled: false,
  asrEnabled: false,
});

async function seedTeachBackStage(page: import('@playwright/test').Page) {
  await page.addInitScript((settings) => {
    localStorage.setItem('settings-storage', settings);
  }, SETTINGS_STORAGE);

  await page.goto('/', { waitUntil: 'networkidle' });

  await page.evaluate(
    ({ stageId, theme }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('MAIC-Database');

        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction(['stages', 'scenes', 'stageOutlines'], 'readwrite');
          const now = Date.now();

          tx.objectStore('stages').put({
            id: stageId,
            name: 'Teach-back Vision E2E',
            description: '',
            language: 'zh-CN',
            style: 'professional',
            whiteboard: [
              {
                id: 'whiteboard-e2e',
                viewportSize: 1000,
                viewportRatio: 0.5625,
                elements: [],
              },
            ],
            createdAt: now,
            updatedAt: now,
          });

          tx.objectStore('scenes').put({
            id: 'scene-teach-back',
            stageId,
            type: 'slide',
            title: '反向讲授测试',
            order: 0,
            content: {
              type: 'slide',
              canvas: {
                id: 'slide-teach-back',
                viewportSize: 1000,
                viewportRatio: 0.5625,
                theme,
                elements: [
                  {
                    id: 'title',
                    type: 'text',
                    content: '<p>请讲解你的思路</p>',
                    left: 80,
                    top: 80,
                    width: 600,
                    height: 80,
                    rotate: 0,
                    defaultFontName: 'Microsoft YaHei',
                    defaultColor: '#111827',
                  },
                ],
              },
            },
            actions: [
              {
                id: 'wait-teach-back',
                type: 'wait_for_user_teaching',
                prompt: '请在白板上画出你的思路，并发送你的讲解。',
              },
            ],
            createdAt: now,
            updatedAt: now,
          });

          tx.objectStore('stageOutlines').put({
            stageId,
            outlines: [],
            createdAt: now,
            updatedAt: now,
          });

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    { stageId: TEST_STAGE_ID, theme: defaultTheme },
  );
}

test.describe('Teach-back Vision', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await seedTeachBackStage(page);
  });

  test('sends teach-back explanation with text and Base64 image_url', async ({ page }) => {
    let interceptedBody: unknown = null;

    await page.route('**/api/chat', async (route) => {
      interceptedBody = JSON.parse(route.request().postData() || '{}');
      const body = interceptedBody as {
        directorState?: unknown;
      };

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: `data: ${JSON.stringify({
          type: 'done',
          data: {
            totalActions: 0,
            totalAgents: 0,
            agentHadContent: false,
            directorState: body.directorState ?? {
              turnCount: 0,
              agentResponses: [],
              whiteboardLedger: [],
            },
          },
        })}\n\n`,
      });
    });

    await page.goto(`/classroom/${TEST_STAGE_ID}`);
    await page.getByText('Loading classroom...').waitFor({ state: 'hidden', timeout: 15_000 });

    const teachBackPrompt = page.getByText('请在白板上画出你的思路，并发送你的讲解。', {
      exact: true,
    });
    await expect(async () => {
      if (!(await teachBackPrompt.first().isVisible().catch(() => false))) {
        const playButton = page.getByRole('button', { name: /^Play$/ }).first();
        if (await playButton.isVisible().catch(() => false)) {
          await playButton.click();
        }
      }
      await expect(teachBackPrompt.first()).toBeVisible({ timeout: 5_000 });
    }).toPass({
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    });

    await page.getByRole('button', { name: '方框' }).click();
    await page.keyboard.press('t');

    const explanation = '我画了一个方框表示核心概念。';
    await page.locator('textarea').last().fill(explanation);
    await page.keyboard.press('Enter');

    await expect
      .poll(() => interceptedBody, {
        timeout: 10_000,
        message: 'wait for /api/chat teach-back request',
      })
      .not.toBeNull();

    const requestBody = interceptedBody as {
      messages?: Array<{
        role?: string;
        parts?: Array<Record<string, unknown>>;
      }>;
    };
    const userMessage = [...(requestBody.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'user');
    const parts = userMessage?.parts ?? [];
    const textPart = parts.find((part) => part.type === 'text' && typeof part.text === 'string') as
      | { text?: string }
      | undefined;
    const imagePart = parts.find(
      (part) =>
        part.type === 'image_url' &&
        typeof (part.image_url as { url?: unknown } | undefined)?.url === 'string',
    ) as { image_url?: { url?: string } } | undefined;

    expect(textPart?.text).toContain(explanation);
    expect(imagePart?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
  });
});
