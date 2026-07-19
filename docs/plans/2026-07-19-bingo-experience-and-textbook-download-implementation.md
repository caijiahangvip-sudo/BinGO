# BinGO 体验与教材库下载改进 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with checkpoints.

**Goal:** 修复教材库下载、启动主题、Logo、用户画像导出和作业模式体验，并通过 `pnpm desktop:build` 同步到 Tauri/Rust 客户端后发布 GitHub。

**Architecture:** 保持现有 Next.js 页面和 Node API 结构，不重写作业求解或教材数据模型。教材库增加 BinGO 内置认证状态与可诊断错误，桌面文件操作通过现有 Tauri 能力封装；启动页使用与主应用一致的主题存储；完成网页端后统一执行桌面构建和签名发布。

**Tech Stack:** Next.js 16、React、TypeScript、Zustand/IndexedDB、Tauri 2、Rust、NSIS、Vitest、Playwright、GitHub CLI。

---

## Task 1: 基线与未提交文件隔离

**Files:**
- Inspect: `git status`, `package.json`, `src-tauri/tauri.conf.json`
- Preserve separately: `src-tauri/windows/installer-template.nsi`

- [ ] **Step 1: Confirm the current baseline and package scripts**

Run:

```powershell
git status --short
pnpm --version
pnpm run
```

Expected: only the known installer template is untracked; desktop build and test scripts are listed.

- [ ] **Step 2: Do not include the untracked installer template in feature commits**

Keep `src-tauri/windows/installer-template.nsi` outside the staging set until its relationship with `src-tauri/nsis/installer.nsi` is explicitly verified.

## Task 2: 教材库请求诊断与 BinGO 内置认证

**Files:**
- Modify: `components/generation/textbook-library-dialog.tsx`
- Modify: `app/api/textbooks/catalog/route.ts`
- Modify: `app/api/textbooks/search/route.ts`
- Modify: `app/api/textbooks/download/route.ts`
- Modify: `lib/server/textbooks.ts`
- Modify: `lib/textbooks/types.ts`
- Add or modify: the existing auth/session route used by the project, discovered from `app/api/desktop/session/route.ts` and `proxy.ts`
- Test: `tests/server/textbooks.test.ts`

- [ ] **Step 1: Add failing tests for upstream error classification**

Add tests covering these exact cases in `tests/server/textbooks.test.ts`:

```ts
it('classifies transport failures as NETWORK_ERROR', async () => {
  const { proxyFetch } = (await import('@/lib/server/proxy-fetch')) as any;
  proxyFetch.mockRejectedValueOnce(new Error('fetch failed'));
  const { getTextbookCatalog } = await import('@/lib/server/textbooks');
  await expect(getTextbookCatalog()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
});

it('classifies 401 and 403 resource responses as AUTH_REQUIRED', async () => {
  const { proxyFetch } = (await import('@/lib/server/proxy-fetch')) as any;
  proxyFetch.mockImplementation(async (url: string) => {
    if (url.includes('details/book-1.json')) return errorResponse(403, 'Forbidden');
    return errorResponse(404, 'Not Found');
  });
  const { downloadTextbookPdf } = await import('@/lib/server/textbooks');
  await expect(downloadTextbookPdf({ contentId: 'book-1' })).rejects.toMatchObject({
    code: 'AUTH_REQUIRED',
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm vitest run tests/server/textbooks.test.ts
```

Expected: FAIL because the current errors are plain `Error` instances and do not expose stable error codes.

- [ ] **Step 3: Introduce typed textbook errors and pass the BinGO session token**

Implement a small `TextbookError` class in `lib/server/textbooks.ts` with `code`, `status`, and `message`. Update route handlers to return the stable code and detail. Read the current BinGO desktop session through the established session mechanism instead of reading system-browser cookies. Pass the token into catalog/detail/resource requests only when the BinGO session exists.

The frontend must show four explicit states: network unavailable, login required/expired, upstream resource missing, and retryable generic failure. A successful BinGO login must be visibly reflected in the dialog.

- [ ] **Step 4: Add an in-app platform login entry and a downloader fallback**

Use the existing desktop/browser surface rather than attempting to decrypt Edge/Chrome cookies. Add controls in `TextbookLibraryDialog`:

```tsx
<Button type="button" variant="outline" onClick={openPlatformLogin}>
  登录国家中小学智慧教育平台
</Button>
<Button type="button" variant="ghost" onClick={launchWindowsDownloader}>
  打开教材下载器
</Button>
```

The login action must refresh the catalog after returning. The fallback calls `/api/textbook-downloader/launch` and reports missing executable or non-Windows support clearly.

- [ ] **Step 5: Run textbook tests and type checks**

Run:

```powershell
pnpm vitest run tests/server/textbooks.test.ts
pnpm exec tsc --noEmit
```

Expected: focused textbook tests PASS and TypeScript has no new errors.

## Task 3: 启动主题同步与 Logo 恢复

**Files:**
- Modify: `desktop-loader/index.html`
- Modify: `desktop-loader/loader.css`
- Modify: `desktop-loader/loader.js`
- Inspect/modify: `lib/hooks/use-theme.tsx`, `lib/theme/theme-runtime.ts`, existing Logo/icon references
- Test: loader behavior with a browser smoke test or deterministic loader helper test

- [ ] **Step 1: Add a deterministic theme resolver test**

Create a test for the loader resolver behavior:

```ts
it('uses the saved light or dark theme before system preference', () => {
  expect(resolveLoaderTheme('light', true)).toBe('light');
  expect(resolveLoaderTheme('dark', false)).toBe('dark');
});
```

- [ ] **Step 2: Implement pre-paint theme application**

Read the same persisted theme setting used by the main app before rendering the loader card. Apply `data-theme="light"` or `data-theme="dark"` to the document element. Fall back to `matchMedia('(prefers-color-scheme: dark)')` for `system` or missing values.

- [ ] **Step 3: Replace the hard-coded dark loader styles**

Use semantic light/dark values based on the Apple reference tokens:

```css
:root[data-theme='light'] {
  --loader-bg: #ffffff;
  --loader-surface: #f7f7fa;
  --loader-text: #1d1d1f;
  --loader-muted: #6e6e73;
  --loader-border: #e5e5ea;
  --loader-accent: #007aff;
}

:root[data-theme='dark'] {
  --loader-bg: #1c1c1e;
  --loader-surface: #2c2c2e;
  --loader-text: #f5f5f7;
  --loader-muted: #aeaeb2;
  --loader-border: #48484a;
  --loader-accent: #0a84ff;
}
```

Remove the blue radial gradient and use the restored BinGO logo asset in the loader card.

- [ ] **Step 4: Verify branding references**

Search all user-facing logo references and ensure the same BinGO asset is used for loader, header/favicon, Tauri icon, and shortcut resources. Do not replace unrelated provider logos.

- [ ] **Step 5: Run loader and build checks**

Run:

```powershell
pnpm vitest run tests/theme tests/utils
pnpm exec tsc --noEmit
```

Expected: theme tests and type check PASS.

## Task 4: 用户画像桌面导出与资源管理器定位

**Files:**
- Modify: `lib/utils/user-profile-export.ts`
- Modify: the settings/profile component that currently emits `用户画像已导出`
- Add/modify: a Tauri command or existing filesystem bridge for desktop save/reveal
- Test: a focused export utility test and desktop command test

- [ ] **Step 1: Add failing tests for default desktop and chosen directory**

Cover these behaviors:

```ts
it('defaults the export destination to the Windows Desktop directory', async () => {
  expect(resolveExportDirectory({ platform: 'win32', selectedDirectory: null })).toMatch(/Desktop$/i);
});

it('uses the user-selected directory when provided', async () => {
  expect(resolveExportDirectory({ platform: 'win32', selectedDirectory: 'D:\\Exports' })).toBe('D:\\Exports');
});
```

- [ ] **Step 2: Implement save and reveal result contract**

Return `{ path, fileName, directory }` from the export action. The default path is the current user Desktop directory. The optional directory picker is used only when the user selects “选择导出位置”.

- [ ] **Step 3: Add “打开所在文件夹” to the success feedback**

Use the Tauri shell/plugin bridge or the existing desktop command layer to reveal the created file in File Explorer. Web mode keeps a browser download fallback and displays the filename.

- [ ] **Step 4: Verify export behavior**

Run focused utility tests, then manually verify desktop export creates a JSON file on Desktop and opens Explorer with the file selected.

## Task 5: 作业模式布局重构

**Files:**
- Modify: `app/homework/page.tsx`
- Modify: `app/globals.css` only for shared semantic utilities if needed
- Modify: `components/homework/homework-math-text.tsx` only when layout semantics require it
- Test: existing homework E2E tests and a new responsive layout assertion

- [ ] **Step 1: Add an E2E assertion for task priority**

The empty homework page must expose one primary upload action, a visible main workspace, and a collapsed or compact follow-up panel rather than three equal empty panels.

- [ ] **Step 2: Implement the structural layout**

Use a CSS grid with a narrow import rail, flexible main workspace, and compact follow-up rail. Keep existing upload, solve, cancel, chat, and result state handlers unchanged. Add explicit empty-state copy that tells the user what to do next.

- [ ] **Step 3: Implement responsive collapse behavior**

At smaller widths, collapse the follow-up rail and keep the main workspace usable. Ensure keyboard focus order follows import -> result -> follow-up.

- [ ] **Step 4: Apply Apple-style semantic tokens**

Use low-contrast borders, system blue for primary actions, restrained shadows, consistent corner radius, and no decorative gradient. Verify light and dark states.

- [ ] **Step 5: Run homework E2E and type checks**

Run:

```powershell
pnpm exec playwright test e2e/tests/home-to-generation.spec.ts
pnpm exec playwright test e2e/tests/generation-flow.spec.ts
pnpm exec tsc --noEmit
```

Expected: existing flows PASS with no new accessibility or overflow failures.

## Task 6: 网页版综合验证

**Files:**
- No new production files; update tests only where failures identify missing coverage.

- [ ] **Step 1: Run focused suites**

```powershell
pnpm vitest run tests/server/textbooks.test.ts tests/theme tests/utils
```

- [ ] **Step 2: Run production type/build checks**

```powershell
pnpm exec tsc --noEmit
pnpm build
```

- [ ] **Step 3: Start the app and manually verify all acceptance paths**

Verify theme persistence, Logo, homework layout, profile export, textbook login/catalog/search/download, and fallback downloader behavior.

## Task 7: 同步 Tauri/Rust 客户端

**Files:**
- Modify: generated desktop artifacts only through `pnpm desktop:build`
- Verify: `src-tauri/tauri.conf.json`, `src-tauri/nsis/installer.nsi`, updater signing configuration

- [ ] **Step 1: Confirm version bump and signing environment**

Update `package.json` and `src-tauri/tauri.conf.json` to the next patch version. Load the existing updater private key into `TAURI_SIGNING_PRIVATE_KEY`; never commit the key.

- [ ] **Step 2: Build the desktop client**

Run:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content 'D:\BinGo\.bingo-keys\bingo-updater.key' -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
pnpm desktop:build
```

Expected: NSIS installer, updater zip, `.sig` files, and `latest.json` are generated successfully.

- [ ] **Step 3: Install and verify desktop behavior**

Verify the loading theme, Logo, homework layout, profile export, textbook login/download, and installer/uninstaller behavior in the built client.

## Task 8: GitHub 发布

**Files:**
- Modify: release metadata generated under the desktop bundle directory

- [ ] **Step 1: Commit source and version changes**

Commit only source, tests, configuration, and intended installer template changes. Never include private keys, temporary logs, or generated debug files.

- [ ] **Step 2: Push branch and tag**

```powershell
git push bingo main
git tag vX.Y.Z
git push bingo vX.Y.Z
```

- [ ] **Step 3: Create the release with all signed assets**

Upload the installer `.exe`, updater `.nsis.zip`, both signature files, and `latest.json`:

```powershell
gh release create vX.Y.Z --repo caijiahangvip-sudo/BinGO --title "vX.Y.Z" --notes-file release-notes.md `
  'BinGO_X.Y.Z_x64-setup.exe' `
  'BinGO_X.Y.Z_x64-setup.nsis.zip' `
  'BinGO_X.Y.Z_x64-setup.nsis.zip.sig' `
  'BinGO_X.Y.Z_x64-setup.exe.sig' `
  'latest.json'
```

- [ ] **Step 4: Verify the published release**

Run `gh release view vX.Y.Z` and confirm all five assets exist and `latest.json` points to the exact release tag and signed updater zip.

---

## Self-review checklist

- All requirements from the design document have an implementation task.
- The plan keeps the existing homework and textbook APIs unless a stable error/session contract is required.
- Browser cookies are not implicitly decrypted or copied.
- The untracked installer template is not included accidentally.
- No task depends on an undefined function without defining its expected contract.
- Desktop synchronization and GitHub release occur only after web tests and manual verification pass.
