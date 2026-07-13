# 星枢 ASTR · Mobile Presence 可信投影实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在不新增后端、不复制 W1 对话状态机的前提下，构建只在本机可信 authority 下挂载的 Mobile Presence；让聊天成为主内容，并以静态星枢 Lens / S 轨承载品牌记忆。

**Architecture:** Mobile 外层只读取 MobileAuthorityPhase；checking 与 remote 只渲染静态事实门，trusted-local 才挂载 TrustedMobilePresenceDomain。可信域显式复用 ConversationRegion + Composer，并通过 owner-scoped bounded ledger 对当前最近 256 个权威终稿按 event id 去重；扫描窗口与 ledger 容量相同，避免真实 remount 产生级联历史重播。共享时间线与 Composer 只保留中性纯色 / none fallback，现有桌面材质由 PresenceExperience.module.css 通过继承变量恢复。

**Tech Stack:** Next.js App Router、React 19、TypeScript、CSS Modules、useSyncExternalStore、Vitest、Testing Library。

## Global Constraints

- 设计规格：docs/superpowers/specs/2026-07-13-astr-mobile-shell-design.md；本计划细化其 5.1、6.1、8、9、10.2 与实施波次 3。
- 只改 webapp 前端；不得修改 backend、API、rewrite、Core client、SSE reducer 或 controller 行为。
- checking / unavailable-remote-context 不得挂载 TrustedMobilePresenceDomain，不得触碰 owner.subscribe、owner.getSnapshot、owner.getServerSnapshot 或 owner.actions。
- trusted-local 直接复用 ConversationRegion 与 Composer；不得复制 projectConversationTimeline、72px 跟随阈值、256+ 未读、终稿接管、IME、selection 恢复、retry 或 voice 逻辑。
- 同一 PresenceControllerOwner 共享一个容量 256 的 final event-id ledger；一次 effect 最多 reconcile / announce 当前投影中最近 256 个 distinct 权威 candidates，未进入 messages 的 distinct authoritative fallback 必须占用这 256 个名额中的最后一席；允许只为判断 fallback 是否已进入 messages 做一次完整 projection membership pass，但完整集合绝不进入 ledger 或公告窗口；不同 owner 隔离；viewport 的 following、unread 与 scrollTop 绝不共享。超出窗口后再次出现的旧 event id 不承诺永久去重。
- 时间线没有 aria-live；页面仍只使用 AppShell 的单个全局 StateAnnouncer。
- displayName 只接受 trim 后非空值；undefined、空串或全空白回退 Soul；internalHandle、model、costTodayUsd、dailyBudgetUsd 不进入 DOM、ARIA 或序列化 HTML。
- Core、Reply SSE 与 Life SSE 必须独立呈现；conversation state 不得替代 Reply SSE。保留 activity 在非 reachable 状态必须标为最近一次 / 可能陈旧；缺失或空白 activity 显示 Core 未提供。
- Mobile Presence 不显示 Safety、Guard、Task、Dispatch、设备、审批、模型、成本或预算事实。
- Mobile 不导入 PresenceExperience、SoulPresence、PresenceVisualHost、Jewel / Pixi / Live2D、Canvas、WebGL、RAF owner 或 Three。
- Mobile route-owned CSS 禁止 gradient、backdrop-filter、filter、box-shadow、绿色、持续 animation 与 @keyframes；允许纯色、静态线条与已有语义 token。
- 静态 Soul Lens 与简化 S 主干必须 aria-hidden、focusable=false；路径无 filter / glow；Lens 外壳 fill:none，facet 使用不透明 --astr-surface-2，core 使用 --astr-soul。
- 对话面板必须拥有 definite block-size、grid-template-rows: minmax(0, 1fr) auto、min-block-size: 0 与 min-inline-size: 0，使内部 ConversationRegion 成为消息滚动容器；面板自身 overflow: visible。Mobile 通过继承 layout guard 把 Composer 限制到 `min(42%, 21rem)` 并设为 `overflow-y:auto`，保证 textarea 纵向 resize、voice/error feedback 与长 diagnostics 可达，同时保留消息 viewport 的多数高度。
- 320 / 390 / 430 / 768 CSS px 不得产生整页横向 overflow；Composer 与底部导航不得被消息列表挤压；软键盘收缩时允许外层滚动把 focused control 带回可见区。
- 昼夜只换现有 token 材质，不改变几何、信息顺序或能力状态；全站禁绿。
- 所有生产改动严格 TDD：先新增测试并观察预期 RED，再写最小生产实现；每个任务独立提交并通过规格与质量复审。
- 本计划只关闭 Presence component tranche，不宣称 /mobile/presence 路由级视觉验收完成。320 / 390 / 430 / 768、dark/light、200% / 400% zoom、soft keyboard、axe、真实 overflow 与截图必须在紧随其后的 Mobile route assembly / browser acceptance 计划中以浏览器证据关闭；本计划先锁定相同几何所需的 CSS source contract，并在 progress ledger 明确记录这些 browser gates 仍 pending。

## 设计压缩

**人类场景：** 用户在手机上注意力有限，先要知道“她此刻是否可达”，随后立即继续真实对话；最大的信任风险是界面把 stale 状态、内部句柄或 remote context 包装成在线事实。

**设计论点：** 这页应像在深夜观测舰上打开一条已校准的灵魂中继，因为用户不是在操作通用聊天机器人，而是在确认同一灵魂的连续存在。界面因此以大面积、稳定、可滚动的对话平面为 Surface，只在静态 Lens 与被截取的 S 轨上集中 Jewel 细节；状态线像校准刻度，不做卡片墙。

**签名时刻：** 权威终稿从 provisional 同 key 接管时，消息位置不跳、离底阅读者不被抢滚动、当前 256-event 窗口内只播报一次；静态 S 轨把 Soul Lens 与对话边缘连接起来，意义在“连续性”，不靠循环动效。

**明确放弃：** 蓝紫渐变雾、玻璃拟态、随机星点、3D 球、Canvas、粒子、持续波形、五张卡片、HUD 数字堆叠和无意义 hover 放大。

## 文件职责

- Modify: webapp/src/features/presence/components/ConversationRegion.tsx
  - 接受可选 announcementLedger；导出按 object scope 缓存 bounded ledger 的 helper。
- Modify: webapp/src/features/presence/components/ConversationRegion.test.tsx
  - 锁定同 scope 跨实例 / remount 去重、不同 scope 隔离、局部滚动状态不共享。
- Modify: webapp/src/features/presence/PresenceExperience.tsx
  - 显式以 presenceControllerOwner 调用 hook，并把 owner-scoped ledger 传给桌面对话。
- Modify: webapp/src/features/presence/PresenceExperience.test.tsx
  - 补齐 owner mock 与桌面材质变量断言。
- Modify: webapp/src/features/presence/components/PresenceTimelines.module.css
  - assistant 与 return-to-latest shadow 改为继承变量 + none fallback。
- Modify: webapp/src/features/presence/components/Composer.module.css
  - Surface 与 accent line 改为继承变量 + 纯色 fallback；共享 chunk 不含 gradient。
- Modify: webapp/src/features/presence/components/Composer.test.tsx
  - 锁定共享 Composer 的中性 CSS 合同。
- Modify: webapp/src/features/presence/PresenceExperience.module.css
  - 仅桌面 dialogueSurface 恢复原有 Composer gradient 与 timeline shadow。
- Create: webapp/src/features/mobile/presence/MobilePresenceDomain.tsx
  - authority 外门；零 controller hook。
- Create: webapp/src/features/mobile/presence/MobilePresenceDomain.test.tsx
  - SSR / hydration / poison owner / pageshow / unmount 验收。
- Create: webapp/src/features/mobile/presence/MobilePresenceDomain.remote.test.tsx
  - 在真实 `remote.example` jsdom origin 下锁定 server-trusted/browser-rejected 组合与 pageshow 重算。
- Create: webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.tsx
  - 唯一可信 W1 adapter；状态事实、静态 Lens / S、ConversationRegion、Composer。
- Create: webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx
  - 真值、隐私、聊天集成、滚动、全局播报与依赖边界验收。
- Create: webapp/src/features/mobile/presence/presence.test-support.ts
  - 两个 Mobile Presence 测试共用的完整、缓存稳定、可计数订阅 owner；不被生产代码导入。
- Create: webapp/src/features/mobile/presence/presence-hydration.test-support.tsx
  - local/remote Domain 测试共用的 poison owner、真实 SSR/hydration harness 与失败安全清理 registry。
- Create: webapp/src/features/mobile/presence/MobilePresenceDomain.module.css
  - 非卡片式独立移动构图、确定高度的聊天面板、静态 Lens / S 语言。

## 事实词典

Core 映射必须逐项使用：

| Semantic core | DOM 文案 |
| --- | --- |
| cold | 未启动 |
| loading | 核验中 |
| reachable | 可达 |
| offline | 离线 |
| error | 状态错误 |

Reply SSE 与 Life SSE 独立使用同一 stream 映射：

| Stream state | DOM 文案 |
| --- | --- |
| connecting | 连接中 |
| open | 已连接 |
| retrying | 重连中 |
| closed | 未连接 |

---

### Task 1: Owner-scoped 权威终稿 ledger

**Files:**
- Modify: webapp/src/features/presence/components/ConversationRegion.tsx
- Modify: webapp/src/features/presence/components/ConversationRegion.test.tsx
- Modify: webapp/src/features/presence/PresenceExperience.tsx
- Modify: webapp/src/features/presence/PresenceExperience.test.tsx

**Interfaces:**
- Consumes: PresenceControllerOwner object identity；现有 createBoundedIdLedger(capacity?)。
- Produces:

~~~ts
export interface ConversationRegionProps {
  readonly conversation: ConversationProjection;
  readonly assistantLabel?: string;
  readonly announceFinal?: FinalAnnouncementPublisher;
  readonly announcementLedger?: BoundedIdLedger;
  readonly headerAction?: ReactNode;
}

export interface BoundedIdLedger {
  readonly size: number;
  readonly remember: (id: string) => boolean;
  readonly reconcileWindow: (ids: readonly string[]) => readonly string[];
}

export function getFinalAnnouncementLedgerForScope(
  scope: object,
): BoundedIdLedger;
~~~

- [ ] **Step 1 — 写 scope ledger RED**

在 ConversationRegion.test.tsx 增加两个行为测试，使用真实 ConversationRegion，不 mock MessageTimeline：

~~~tsx
it("deduplicates one final event across instances and real remounts sharing a scope ledger", () => {
  const announce = vi.fn();
  const scope = {};
  const ledger = getFinalAnnouncementLedgerForScope(scope);
  const final = message({
    id: "reply:shared-scope",
    role: "qiuqiu",
    text: "同一权威终稿",
    eventId: "decision-shared-scope",
  });

  const first = render(
    <ConversationRegion
      announcementLedger={ledger}
      announceFinal={announce}
      conversation={conversation({ messages: [final] })}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(1);
  first.unmount();

  const second = render(
    <ConversationRegion
      announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
      announceFinal={announce}
      conversation={conversation({ messages: [{ ...final }] })}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(1);
  second.unmount();
});

it("isolates final ledgers by owner scope", () => {
  const firstAnnounce = vi.fn();
  const secondAnnounce = vi.fn();
  const final = message({
    id: "reply:scope-isolation",
    role: "qiuqiu",
    text: "隔离终稿",
    eventId: "decision-scope-isolation",
  });

  render(
    <>
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope({})}
        announceFinal={firstAnnounce}
        conversation={conversation({ messages: [final] })}
      />
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope({})}
        announceFinal={secondAnnounce}
        conversation={conversation({ messages: [{ ...final }] })}
      />
    </>,
  );

  expect(firstAnnounce).toHaveBeenCalledTimes(1);
  expect(secondAnnounce).toHaveBeenCalledTimes(1);
});

it("shares one ledger without sharing two concurrent viewport scroll states", () => {
  const announce = vi.fn();
  const ledger = getFinalAnnouncementLedgerForScope({});
  const final = message({
    id: "reply:shared-ledger-local-scroll",
    role: "qiuqiu",
    text: "共享公告，不共享滚动",
    eventId: "decision-shared-ledger-local-scroll",
  });

  render(
    <>
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({ messages: [final] })}
      />
      <ConversationRegion
        announcementLedger={ledger}
        announceFinal={announce}
        conversation={conversation({ messages: [{ ...final }] })}
      />
    </>,
  );

  expect(announce).toHaveBeenCalledTimes(1);
  const viewports = screen.getAllByRole("region", { name: "对话记录" });
  viewports[0].scrollTop = 100;
  fireEvent.scroll(viewports[0]);
  expect(screen.getAllByRole("button", { name: "回到最新" })).toHaveLength(1);
  expect(viewports[0]).toHaveAttribute("tabindex", "0");
  expect(viewports[1]).toHaveAttribute("tabindex", "0");
});

it("reconciles only the newest 256 finals so a remount cannot cascade-replay evicted history", () => {
  const announce = vi.fn();
  const scope = {};
  const finals = Array.from({ length: 257 }, (_, index) =>
    message({
      id: "reply:bounded-" + index,
      role: "qiuqiu",
      text: "终稿 " + index,
      eventId: "decision-bounded-" + index,
    }),
  );
  const first = render(
    <ConversationRegion
      announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
      announceFinal={announce}
      conversation={conversation({
        messages: finals,
        authoritativeDecision: decision(
          "decision-bounded-0",
          "trace-bounded",
          "终稿 0",
        ),
      })}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(256);
  expect(announce).not.toHaveBeenCalledWith(
    expect.stringContaining("终稿 0"),
    "polite",
  );
  first.unmount();

  const second = render(
    <ConversationRegion
      announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
      announceFinal={announce}
      conversation={conversation({
        messages: finals.map((item) => ({ ...item })),
        authoritativeDecision: decision(
          "decision-bounded-0",
          "trace-bounded",
          "终稿 0",
        ),
      })}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(256);
  second.unmount();
});

it("counts a distinct authoritative fallback inside the same 256-event window", () => {
  const announce = vi.fn();
  const scope = {};
  const finals = Array.from({ length: 256 }, (_, index) =>
    message({
      id: "reply:fallback-window-" + index,
      role: "qiuqiu",
      text: "消息终稿 " + index,
      eventId: "decision:fallback-window-" + index,
    }),
  );
  const projection = conversation({
    messages: finals,
    authoritativeDecision: decision(
      "decision:distinct-fallback",
      "trace:distinct-fallback",
      "独立 fallback",
    ),
  });

  const first = render(
    <ConversationRegion
      announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
      announceFinal={announce}
      conversation={projection}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(256);
  expect(announce).toHaveBeenCalledWith(
    "Soul 的权威终稿：独立 fallback",
    "polite",
  );
  expect(announce).not.toHaveBeenCalledWith(
    expect.stringContaining("消息终稿 0"),
    "polite",
  );
  first.unmount();

  const second = render(
    <ConversationRegion
      announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
      announceFinal={announce}
      conversation={conversation({
        messages: finals.map((item) => ({ ...item })),
        authoritativeDecision: decision(
          "decision:distinct-fallback",
          "trace:distinct-fallback",
          "独立 fallback",
        ),
      })}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(256);
  second.rerender(
    <ConversationRegion
      announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
      announceFinal={announce}
      conversation={conversation({
        messages: finals.map((item) => ({ ...item })),
        authoritativeDecision: null,
      })}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(257);
  expect(announce).toHaveBeenLastCalledWith(
    "Soul 回答完成：消息终稿 0",
    "polite",
  );

  second.rerender(
    <ConversationRegion
      announcementLedger={getFinalAnnouncementLedgerForScope(scope)}
      announceFinal={announce}
      conversation={conversation({
        messages: finals.map((item) => ({ ...item })),
        authoritativeDecision: null,
      })}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(257);
  second.unmount();
});

it("atomically reconciles the newest distinct ids without eviction cascades", () => {
  const ledger = createBoundedIdLedger(3);

  expect(ledger.reconcileWindow(["a", "b", "b", "c", "d"])).toEqual([
    "b",
    "c",
    "d",
  ]);
  expect(ledger.size).toBe(3);
  expect(ledger.reconcileWindow(["a", "b", "c"])).toEqual(["a"]);
  expect(ledger.size).toBe(3);
  expect(ledger.reconcileWindow(["a", "b", "c"])).toEqual([]);
});

it("resets the same mounted viewport when its owner ledger changes", () => {
  const announce = vi.fn();
  const firstLedger = getFinalAnnouncementLedgerForScope({});
  const secondLedger = getFinalAnnouncementLedgerForScope({});
  const final = message({
    id: "reply:owner-switch",
    role: "qiuqiu",
    text: "作用域切换终稿",
    eventId: "decision-owner-switch",
  });
  const { rerender } = render(
    <ConversationRegion
      announcementLedger={firstLedger}
      announceFinal={announce}
      conversation={conversation({ messages: [final] })}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(1);
  const viewport = screen.getByRole("region", { name: "对话记录" });
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);

  const update = message({
    id: "reply:owner-switch-update",
    role: "qiuqiu",
    text: "A owner 的未读终稿",
    eventId: "decision-owner-switch-update",
  });
  rerender(
    <ConversationRegion
      announcementLedger={firstLedger}
      announceFinal={announce}
      conversation={conversation({ messages: [final, update] })}
    />,
  );
  expect(
    screen.getByRole("button", { name: "回到最新，1 条未读更新" }),
  ).toBeVisible();
  expect(viewport.scrollTop).toBe(100);

  rerender(
    <ConversationRegion
      announcementLedger={secondLedger}
      announceFinal={announce}
      conversation={conversation({ messages: [{ ...final }] })}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("region", { name: "对话记录" })).toBe(viewport);
  expect(viewport.scrollTop).toBe(800);
  expect(screen.queryByRole("button", { name: /回到最新/ })).toBeNull();
});
~~~

同时把 getFinalAnnouncementLedgerForScope 加入测试 import。

- [ ] **Step 2 — 运行 RED**

Run:

~~~powershell
npm test -- --run src/features/presence/components/ConversationRegion.test.tsx
~~~

Expected: FAIL；缺少导出、prop 或跨 remount 仍重复播报。不得以修改测试数据避开失败。

- [ ] **Step 3 — 实现 bounded WeakMap seam**

先扩展现有 ledger；`remember` 的既有 bounded insertion 合同保持不变，公告 effect 使用新的原子窗口 API：

~~~ts
export interface BoundedIdLedger {
  readonly size: number;
  readonly remember: (id: string) => boolean;
  readonly reconcileWindow: (ids: readonly string[]) => readonly string[];
}

export function createBoundedIdLedger(
  capacity = FINAL_ANNOUNCEMENT_ID_CAPACITY,
): BoundedIdLedger {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError("A bounded id ledger requires a positive integer capacity.");
  }
  const ids = new Set<string>();
  const order: string[] = [];
  return Object.freeze({
    get size() {
      return ids.size;
    },
    remember(id: string) {
      if (ids.has(id)) return false;
      ids.add(id);
      order.push(id);
      if (order.length > capacity) {
        const evicted = order.shift();
        if (evicted !== undefined) ids.delete(evicted);
      }
      return true;
    },
    reconcileWindow(nextIds: readonly string[]) {
      const nextOrder = boundedDistinctWindow(nextIds, capacity);
      const unseen = nextOrder.filter((id) => !ids.has(id));
      ids.clear();
      order.length = 0;
      for (const id of nextOrder) {
        ids.add(id);
        order.push(id);
      }
      return Object.freeze(unseen);
    },
  });
}

function boundedDistinctWindow(
  values: readonly string[],
  capacity: number,
): string[] {
  const seen = new Set<string>();
  const newestFirst: string[] = [];
  for (
    let index = values.length - 1;
    index >= 0 && newestFirst.length < capacity;
    index -= 1
  ) {
    const id = values[index];
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    newestFirst.push(id);
  }
  return newestFirst.reverse();
}
~~~

在 ConversationRegion.tsx 的 BoundedIdLedger 定义附近再加入 owner cache：

~~~ts
const scopedFinalAnnouncementLedgers = new WeakMap<object, BoundedIdLedger>();

export function getFinalAnnouncementLedgerForScope(
  scope: object,
): BoundedIdLedger {
  const existing = scopedFinalAnnouncementLedgers.get(scope);
  if (existing) return existing;
  const created = createBoundedIdLedger();
  scopedFinalAnnouncementLedgers.set(scope, created);
  return created;
}
~~~

给 props 增加 announcementLedger，并把当前实例 ledger 改为 fallback：

~~~ts
export function ConversationRegion({
  conversation,
  assistantLabel,
  announceFinal = defaultFinalAnnouncement,
  announcementLedger,
  headerAction,
}: ConversationRegionProps) {
  const localAnnouncementLedgerRef = useRef<BoundedIdLedger | null>(null);
  if (localAnnouncementLedgerRef.current === null) {
    localAnnouncementLedgerRef.current = createBoundedIdLedger();
  }
  const resolvedAnnouncementLedger =
    announcementLedger ?? localAnnouncementLedgerRef.current;
~~~

在现有 scroll callbacks 之后、处理 entries 的 `useLayoutEffect` 之前加入 scope reset；声明 `previousAnnouncementLedgerRef` 时以 `resolvedAnnouncementLedger` 初始化：

~~~tsx
const previousAnnouncementLedgerRef = useRef(resolvedAnnouncementLedger);

useLayoutEffect(() => {
  if (previousAnnouncementLedgerRef.current === resolvedAnnouncementLedger) {
    return;
  }
  previousAnnouncementLedgerRef.current = resolvedAnnouncementLedger;
  previousEntriesRef.current = null;
  scrollToLatest();
}, [resolvedAnnouncementLedger, scrollToLatest]);
~~~

这样 owner scope 切换会清除旧 following / unread，并让下一次 entries reconciliation 视为新 viewport 基线；DOM viewport 本身不需要 remount。删除 previousMessagesRef 与 previousFallbackDecisionIdRef 两个声明。完整替换 final announcement effect，ledger 成为唯一去重真源，并让 candidate reconciliation window 与 ledger capacity 相同：

~~~tsx
useEffect(() => {
  const projectedEventIds = new Set<string>();
  for (const message of conversation.messages) {
    if (message.role === "qiuqiu" && isNonBlankString(message.eventId)) {
      projectedEventIds.add(message.eventId);
    }
  }
  const fallback = compatibleDecision(
    conversation.authoritativeDecision,
    conversation.receipt?.trace_id,
  );
  const distinctFallback =
    fallback && !projectedEventIds.has(fallback.id) ? fallback : null;
  const messageWindowCapacity =
    FINAL_ANNOUNCEMENT_ID_CAPACITY - (distinctFallback ? 1 : 0);
  const messageCandidates: Array<{
    readonly eventId: string;
    readonly copy: string;
  }> = [];
  const windowEventIds = new Set<string>();

  for (
    let index = conversation.messages.length - 1;
    index >= 0 && messageCandidates.length < messageWindowCapacity;
    index -= 1
  ) {
    const message = conversation.messages[index];
    if (
      message === undefined ||
      message.role !== "qiuqiu" ||
      !isNonBlankString(message.eventId) ||
      windowEventIds.has(message.eventId)
    ) {
      continue;
    }
    windowEventIds.add(message.eventId);
    messageCandidates.push({
      eventId: message.eventId,
      copy: finalAnnouncementCopy(message, visibleAssistantLabel),
    });
  }
  messageCandidates.reverse();

  const candidates = [...messageCandidates];
  if (distinctFallback) {
    candidates.push({
      eventId: distinctFallback.id,
      copy: visibleAssistantLabel + " 的权威终稿：" + distinctFallback.text,
    });
  }

  const unseenEventIds = new Set(
    resolvedAnnouncementLedger.reconcileWindow(
      candidates.map((candidate) => candidate.eventId),
    ),
  );
  for (const candidate of candidates) {
    if (!unseenEventIds.has(candidate.eventId)) continue;
    announceFinal(candidate.copy, "polite");
  }
}, [
  announceFinal,
  conversation.authoritativeDecision,
  conversation.messages,
  conversation.receipt?.trace_id,
  resolvedAnnouncementLedger,
  visibleAssistantLabel,
]);
~~~

`projectedEventIds` 必须覆盖完整消息投影，但只用于 membership 判断，不进入 ledger，也不驱动公告；若存在未投影的 distinct authoritative fallback，先为它预留 1 个容量，再反向提取最近的 distinct message event ids，最终交给 `reconcileWindow` 的 candidates 仍严格不超过 256。`reconcileWindow` 必须先用旧窗口计算 unseen，再一次性替换成新窗口，绝不能在遍历 candidates 时逐项逐出；否则 fallback 消失或重复 message record 都会触发级联重播。上面的 bounded RED 锁定 duplicate、窗口成员替换与 stable rerender。

不要共享 followingRef、unreadIdsRef、previousEntriesRef 或 viewportRef。owner / ledger prop 在同一挂载实例切换时，新 ledger 会对当前最近 256 个 finals 重新建立自己的公告基线；上面的 RED 明确锁定该行为。

Run:

~~~powershell
npm test -- --run src/features/presence/components/ConversationRegion.test.tsx
~~~

Expected: Task 1 的 scope、remount、bounded fallback、owner switch 与 viewport RED 全部转 GREEN；在此证据成立后才进入桌面 wiring 的下一轮 RED。

- [ ] **Step 4 — 先写桌面 owner wiring RED，并隔离每个测试的 ledger scope**

PresenceExperience.test.tsx 的 hoisted mock 改为每个测试可替换、单个测试内稳定的 owner；getter 保持 ESM live binding：

~~~ts
const controllerMocks = vi.hoisted(() => ({
  owner: {},
  usePresenceController: vi.fn(),
}));

vi.mock("@/features/presence/controller/use-presence-controller", () => ({
  get presenceControllerOwner() {
    return controllerMocks.owner;
  },
  usePresenceController: controllerMocks.usePresenceController,
}));

beforeEach(() => {
  controllerMocks.owner = {};
  controllerMocks.usePresenceController.mockReset();
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-visual-motion");
  semanticStore.setState({ ...initialSemanticState, announcement: null });
  controllerMocks.usePresenceController.mockReturnValue({
    snapshot: createSnapshot(),
    actions,
  });
});
~~~

把现有首个 render 断言扩成：

~~~ts
expect(controllerMocks.usePresenceController).toHaveBeenCalledWith(
  controllerMocks.owner,
);
~~~

每个 beforeEach 都换 owner object，确保 WeakMap ledger 不会把一个测试的 decision-1 污染到下一个测试；不得依赖 clearMocks 清空 WeakMap。

Run:

~~~powershell
npm test -- --run src/features/presence/PresenceExperience.test.tsx
~~~

Expected: FAIL because current PresenceExperience calls usePresenceController with no owner argument。

- [ ] **Step 5 — 连接桌面 owner**

PresenceExperience.tsx 显式导入 presenceControllerOwner，并把同一对象同时用于 hook 与 ledger：

~~~tsx
import {
  presenceControllerOwner,
  usePresenceController,
} from "@/features/presence/controller/use-presence-controller";
import {
  ConversationRegion,
  getFinalAnnouncementLedgerForScope,
} from "./components/ConversationRegion";

export function PresenceExperience() {
  const owner = presenceControllerOwner;
  const { snapshot, actions } = usePresenceController(owner);
  const announcementLedger = getFinalAnnouncementLedgerForScope(owner);
~~~

ConversationRegion 增加：

~~~tsx
announcementLedger={announcementLedger}
~~~

- [ ] **Step 6 — 运行 GREEN 与边界**

Run:

~~~powershell
npm test -- --run src/features/presence/components/ConversationRegion.test.tsx src/features/presence/PresenceExperience.test.tsx
~~~

Expected: all PASS；无 act、hydration、getSnapshot cache warning。

Run:

~~~powershell
npm run typecheck
~~~

Expected: exit 0。

- [ ] **Step 7 — 精确提交**

~~~powershell
git add -- webapp/src/features/presence/components/ConversationRegion.tsx webapp/src/features/presence/components/ConversationRegion.test.tsx webapp/src/features/presence/PresenceExperience.tsx webapp/src/features/presence/PresenceExperience.test.tsx
git commit -m "refactor: scope Presence final announcements"
~~~

---

### Task 2: 共享聊天组件中性化，桌面材质路由化

**Files:**
- Modify: webapp/src/features/presence/components/PresenceTimelines.module.css
- Modify: webapp/src/features/presence/components/ConversationRegion.test.tsx
- Modify: webapp/src/features/presence/components/Composer.module.css
- Modify: webapp/src/features/presence/components/Composer.test.tsx
- Modify: webapp/src/features/presence/PresenceExperience.module.css
- Modify: webapp/src/features/presence/PresenceExperience.test.tsx

**Interfaces:**
- Produces inherited tokens:

~~~css
--astr-timeline-assistant-shadow
--astr-timeline-return-shadow
--astr-composer-surface
--astr-composer-accent-line
--astr-composer-shadow
--astr-composer-max-block-size
--astr-composer-overflow-y
~~~

- 前五个是 skin tokens：Mobile 不设置，因而使用 none / solid fallback；Desktop dialogueSurface 恢复原值。后两个是 layout guard tokens：共享 Composer 默认 `none / visible`，Mobile dialogueSurface 设置有界值，避免可 resize textarea 或长 diagnostics 把消息 viewport 压到 0。

- [ ] **Step 1 — 写 CSS constitution RED**

Composer.test.tsx 的首个 CSS 合同测试中加入：

~~~ts
expect(css).toMatch(
  /background:\s*var\(\s*--astr-composer-surface,\s*color-mix\(/,
);
expect(css).toMatch(
  /background:\s*var\(\s*--astr-composer-accent-line,\s*var\(--astr-action\)\s*\)/,
);
expect(css).toMatch(
  /box-shadow:\s*var\(\s*--astr-composer-shadow,\s*none\s*\)/,
);
expect(css).toMatch(
  /max-block-size:\s*var\(\s*--astr-composer-max-block-size,\s*none\s*\)/,
);
expect(css).toMatch(
  /overflow-y:\s*var\(\s*--astr-composer-overflow-y,\s*visible\s*\)/,
);
expect(css).not.toMatch(/gradient/i);
~~~

ConversationRegion.test.tsx 的 source boundary 中加入：

~~~ts
expect(cssSource).toMatch(
  /box-shadow:\s*var\(\s*--astr-timeline-assistant-shadow,\s*none\s*\)/,
);
expect(cssSource).toMatch(
  /box-shadow:\s*var\(\s*--astr-timeline-return-shadow,\s*none\s*\)/,
);
expect(cssSource).not.toContain("var(--glow-her-1)");
expect(cssSource).not.toContain("var(--shadow-2)");
~~~

PresenceExperience.test.tsx 的 responsive material constitution 中加入：

~~~ts
expect(experienceCss).toMatch(
  /--astr-composer-surface:\s*linear-gradient\([\s\S]*?color-mix\(/,
);
expect(experienceCss).toMatch(
  /--astr-composer-accent-line:\s*linear-gradient\(/,
);
expect(experienceCss).toMatch(
  /--astr-composer-shadow:\s*inset\s+0\s+1px\s+0\s+color-mix\(/,
);
expect(experienceCss).toMatch(
  /--astr-timeline-assistant-shadow:\s*var\(--glow-her-1\)/,
);
expect(experienceCss).toMatch(
  /--astr-timeline-return-shadow:\s*var\(--shadow-2\)/,
);
~~~

- [ ] **Step 2 — 运行 RED**

Run:

~~~powershell
npm test -- --run src/features/presence/components/Composer.test.tsx src/features/presence/components/ConversationRegion.test.tsx src/features/presence/PresenceExperience.test.tsx
~~~

Expected: FAIL 于共享 CSS 仍含直接 gradient / shadow，桌面 CSS 尚未声明变量。

- [ ] **Step 3 — 中性化共享 CSS**

Composer.module.css 精确替换：

~~~css
.composer {
  background: var(
    --astr-composer-surface,
    color-mix(in srgb, var(--astr-surface) 92%, var(--astr-bg))
  );
  box-shadow: var(--astr-composer-shadow, none);
  max-block-size: var(--astr-composer-max-block-size, none);
  overflow-y: var(--astr-composer-overflow-y, visible);
}

.composer::before {
  background: var(--astr-composer-accent-line, var(--astr-action));
}
~~~

保留 .composer 与 ::before 其余已有声明不变。

PresenceTimelines.module.css 精确替换：

~~~css
.assistantBubble {
  box-shadow: var(--astr-timeline-assistant-shadow, none);
}

.returnLatest {
  box-shadow: var(--astr-timeline-return-shadow, none);
}
~~~

保留两条规则其余已有声明不变。

- [ ] **Step 4 — 在桌面 Surface 恢复原值**

PresenceExperience.module.css 的 .dialogueSurface 起始处加入：

~~~css
.dialogueSurface {
  --astr-composer-surface:
    linear-gradient(
      110deg,
      color-mix(in srgb, var(--astr-soul) 7%, transparent),
      transparent 34%
    ),
    color-mix(in srgb, var(--astr-surface) 92%, transparent);
  --astr-composer-accent-line:
    linear-gradient(90deg, var(--astr-action), transparent);
  --astr-composer-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--astr-action) 10%, transparent);
  --astr-timeline-assistant-shadow: var(--glow-her-1);
  --astr-timeline-return-shadow: var(--shadow-2);
~~~

已有 desktop 几何、背景、边框和 shadow 继续原样保留。共享 CSS 中不得残留 gradient、--glow-her-1 或 --shadow-2。

- [ ] **Step 5 — 运行 GREEN 与静态扫描**

Run:

~~~powershell
npm test -- --run src/features/presence/components/Composer.test.tsx src/features/presence/components/ConversationRegion.test.tsx src/features/presence/PresenceExperience.test.tsx
~~~

Expected: all PASS。

Run:

~~~powershell
rg -n -i "gradient|--glow-her-1|--shadow-2" src/features/presence/components/Composer.module.css src/features/presence/components/PresenceTimelines.module.css
~~~

Expected: exit 1。

Run:

~~~powershell
npm run typecheck
~~~

Expected: exit 0。

- [ ] **Step 6 — 精确提交**

~~~powershell
git add -- webapp/src/features/presence/components/PresenceTimelines.module.css webapp/src/features/presence/components/ConversationRegion.test.tsx webapp/src/features/presence/components/Composer.module.css webapp/src/features/presence/components/Composer.test.tsx webapp/src/features/presence/PresenceExperience.module.css webapp/src/features/presence/PresenceExperience.test.tsx
git commit -m "refactor: isolate Presence visual skin"
~~~

---

### Task 3: Mobile Presence authority 外门

**Files:**
- Create: webapp/src/features/mobile/presence/MobilePresenceDomain.tsx
- Create: webapp/src/features/mobile/presence/MobilePresenceDomain.test.tsx
- Create: webapp/src/features/mobile/presence/MobilePresenceDomain.remote.test.tsx
- Create: webapp/src/features/mobile/presence/MobilePresenceDomain.module.css
- Create: webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.tsx
- Create: webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx
- Create: webapp/src/features/mobile/presence/presence.test-support.ts
- Create: webapp/src/features/mobile/presence/presence-hydration.test-support.tsx

**Interfaces:**
- Consumes: useMobileAuthority(): MobileAuthorityPhase、usePresenceController(owner)、ConversationRegion、Composer 与 owner-scoped ledger。
- Produces:

~~~tsx
export interface MobilePresenceDomainProps {
  readonly owner?: PresenceControllerOwner;
}

export function MobilePresenceDomain(
  props: MobilePresenceDomainProps,
): ReactNode;
~~~

- [ ] **Step 1 — 写完整共享 test owner，再写真实 trusted child 核心复用 RED**

presence.test-support.ts 提供完整而稳定的 owner；它只被测试导入：

~~~ts
import { vi } from "vitest";
import type {
  PresenceControllerActions,
  PresenceControllerSnapshot,
} from "@/features/presence/controller/create-presence-controller";
import type { PresenceControllerOwner } from "@/features/presence/controller/use-presence-controller";

export interface PresenceOwnerFixture {
  readonly owner: PresenceControllerOwner;
  readonly actions: PresenceControllerActions;
  readonly activeSubscribers: () => number;
  readonly peakSubscribers: () => number;
  readonly emit: (snapshot: PresenceControllerSnapshot) => void;
}

export function createPresenceOwnerFixture(
  initialSnapshot: PresenceControllerSnapshot,
): PresenceOwnerFixture {
  let snapshot = initialSnapshot;
  let active = 0;
  let peak = 0;
  const listeners = new Set<() => void>();
  const actions: PresenceControllerActions = {
    updateDraft: vi.fn(),
    send: vi.fn(async () => true),
    retryFailed: vi.fn(async () => true),
    transcribe: vi.fn(async () => ({ text: "测试转写" })),
    estop: vi.fn(async () => false),
    reset: vi.fn(async () => false),
  };

  const owner: PresenceControllerOwner = {
    subscribe(listener) {
      listeners.add(listener);
      active += 1;
      peak = Math.max(peak, active);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        listeners.delete(listener);
        active -= 1;
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    actions,
  };

  return {
    owner,
    actions,
    activeSubscribers: () => active,
    peakSubscribers: () => peak,
    emit(nextSnapshot) {
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
  };
}
~~~

TrustedMobilePresenceDomain.test.tsx 从该 helper 导入 fixture，返回同一 PRESENCE_CONTROLLER_SERVER_SNAPSHOT。测试真实行为：

~~~tsx
it("mounts the existing conversation and Composer against the injected owner", () => {
  const fixture = createPresenceOwnerFixture(
    PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
  );
  const { unmount } = render(
    <TrustedMobilePresenceDomain owner={fixture.owner} />,
  );

  expect(screen.getByRole("heading", { level: 1, name: "与 Soul 对话" })).toBeVisible();
  expect(screen.getByRole("region", { name: "对话记录" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "消息输入" })).toBeVisible();
  expect(fixture.activeSubscribers()).toBe(1);
  unmount();
  expect(fixture.activeSubscribers()).toBe(0);
});
~~~

不要 mock ConversationRegion 或 Composer。

- [ ] **Step 2 — 运行 trusted child RED**

Run:

~~~powershell
npm test -- --run src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx
~~~

Expected: FAIL because TrustedMobilePresenceDomain is missing。

- [ ] **Step 3 — 实现最小但真实的 trusted child**

TrustedMobilePresenceDomain.tsx：

~~~tsx
"use client";

import type { ReactNode } from "react";
import { Composer } from "@/features/presence/components/Composer";
import {
  ConversationRegion,
  getFinalAnnouncementLedgerForScope,
} from "@/features/presence/components/ConversationRegion";
import {
  presenceControllerOwner,
  usePresenceController,
  type PresenceControllerOwner,
} from "@/features/presence/controller/use-presence-controller";

export interface TrustedMobilePresenceDomainProps {
  readonly owner?: PresenceControllerOwner;
}

export function TrustedMobilePresenceDomain({
  owner = presenceControllerOwner,
}: TrustedMobilePresenceDomainProps): ReactNode {
  const { snapshot, actions } = usePresenceController(owner);
  const assistantLabel = nonblank(snapshot.status?.displayName) ?? "Soul";

  return (
    <section>
      <h1>与 {assistantLabel} 对话</h1>
      <ConversationRegion
        announcementLedger={getFinalAnnouncementLedgerForScope(owner)}
        assistantLabel={assistantLabel}
        conversation={snapshot.conversation}
      />
      <Composer
        actions={actions}
        snapshot={{
          conversation: snapshot.conversation,
          diagnostics: snapshot.diagnostics,
          draft: snapshot.draft,
          semantic: snapshot.semantic,
        }}
      />
    </section>
  );
}

function nonblank(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
~~~

这是可工作的真实对话投影，不是临时空壳；Task 4 只在先有 RED 的前提下增加状态、Lens 与构图。

- [ ] **Step 4 — 运行 trusted child GREEN**

Run:

~~~powershell
npm test -- --run src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx
~~~

Expected: PASS。

- [ ] **Step 5 — 写 poison-owner SSR / hydration RED**

MobilePresenceDomain.test.tsx 与独立 remote test 都使用真实 MobileAuthorityProvider 和真实 hostname evaluator，不 mock trusted child。`presence-hydration.test-support.tsx` 先提供会记录并立即抛错的完整 owner：

~~~ts
export function createPoisonOwner() {
  const touches = vi.fn((member: string): never => {
    throw new Error("Presence owner touched: " + member);
  });
  const owner: PresenceControllerOwner = {
    subscribe: vi.fn(() => touches("subscribe")),
    getSnapshot: vi.fn(() => touches("getSnapshot")),
    getServerSnapshot: vi.fn(() => touches("getServerSnapshot")),
    get actions() {
      return touches("actions");
    },
  };
  return { owner, touches };
}
~~~

加入：

~~~tsx
it("server-renders checking without touching any Presence owner method", () => {
  const poison = createPoisonOwner();
  const html = renderToString(
    <MobileAuthorityProvider serverAuthorityTrusted>
      <MobilePresenceDomain owner={poison.owner} />
    </MobileAuthorityProvider>,
  );
  expect(html).toContain("正在核验本机 Presence");
  expect(html).not.toContain("消息输入");
  expect(poison.touches).not.toHaveBeenCalled();
});

it("server-renders remote capability truth with zero owner access", () => {
  const poison = createPoisonOwner();
  const html = renderToString(
    <MobileAuthorityProvider serverAuthorityTrusted={false}>
      <MobilePresenceDomain owner={poison.owner} />
    </MobileAuthorityProvider>,
  );
  expect(html).toContain("未连接 Core");
  expect(html).toContain("当前来源或 Core 目标不是本机可信入口");
  expect(html).not.toContain("消息输入");
  expect(html).not.toContain('href="/"');
  expect(html).not.toContain('href="/admin');
  expect(poison.touches).not.toHaveBeenCalled();
});
~~~

同一步先写 gate CSS constitution RED；空 CSS module 不能让行为测试假绿：

~~~ts
it("locks the authority gate to a solid asymmetric surface", () => {
  const css = readFileSync(
    resolve(
      process.cwd(),
      "src/features/mobile/presence/MobilePresenceDomain.module.css",
    ),
    "utf8",
  );
  const gateRule = css.match(/\.gate\s*\{([^}]*)\}/s)?.[1];
  expect(gateRule).toBeDefined();
  expect(gateRule).toContain("min-inline-size: 0");
  expect(gateRule).toContain("max-inline-size: 52rem");
  expect(gateRule).toContain("border-block: 1px solid var(--astr-hairline-strong)");
  expect(gateRule).toContain("border-inline-start: 3px solid var(--astr-soul)");
  expect(gateRule).toContain("background: var(--astr-surface)");
  expect(gateRule).not.toMatch(/border-radius|box-shadow/);
  expect(css).not.toMatch(
    /gradient|backdrop-filter|filter\s*:|@keyframes|animation\s*:|\bgreen\b|\blime\b|\bemerald\b|\bchartreuse\b/i,
  );
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
});
~~~

同一 support 文件使用真实 SSR + hydration，并封装可由每个测试文件 afterEach 调用的 registry；即使断言或 hydration 失败也不得遗留 host/subscription。完整代码（加上上面的 createPoisonOwner 与所需 imports）：

~~~tsx
interface MountedDomain {
  readonly host: HTMLDivElement;
  root: Root | null;
}

export interface HydratedDomain {
  readonly serverHtml: string;
  readonly host: HTMLDivElement;
  readonly recoverableError: ReturnType<typeof vi.fn>;
  readonly unmount: () => Promise<void>;
}

export function createDomainHydrationHarness() {
  const mountedDomains = new Set<MountedDomain>();

  async function releaseDomain(mount: MountedDomain): Promise<void> {
    if (!mountedDomains.delete(mount)) return;
    const root = mount.root;
    try {
      if (root) await act(async () => root.unmount());
    } finally {
      mount.host.remove();
    }
  }

  return Object.freeze({
    async hydrate(
      serverAuthorityTrusted: boolean,
      owner: PresenceControllerOwner,
    ): Promise<HydratedDomain> {
      const tree = (
        <MobileAuthorityProvider serverAuthorityTrusted={serverAuthorityTrusted}>
          <MobilePresenceDomain owner={owner} />
        </MobileAuthorityProvider>
      );
      const serverHtml = renderToString(tree);
      const host = document.createElement("div");
      host.innerHTML = serverHtml;
      document.body.append(host);
      const recoverableError = vi.fn();
      const mount: MountedDomain = { host, root: null };
      mountedDomains.add(mount);

      try {
        await act(async () => {
          mount.root = hydrateRoot(host, tree, {
            onRecoverableError: recoverableError,
          });
        });
      } catch (error) {
        await releaseDomain(mount);
        throw error;
      }

      return {
        serverHtml,
        host,
        recoverableError,
        unmount: () => releaseDomain(mount),
      };
    },
    async releaseAll(): Promise<void> {
      for (const mount of [...mountedDomains]) await releaseDomain(mount);
    },
  };
}
~~~

MobilePresenceDomain.test.tsx 创建独立 harness 并保证清理；remote test 为了在 Provider import 前安装真实 evaluator spy，在测试体内动态 import support 并用 finally 清理：

~~~ts
const hydration = createDomainHydrationHarness();

afterEach(async () => {
  await hydration.releaseAll();
  vi.restoreAllMocks();
});
~~~

server-false remote hydration 精确测试：

~~~tsx
const poison = createPoisonOwner();
const remote = await hydration.hydrate(false, poison.owner);
await waitFor(() => {
  expect(remote.host.textContent).toContain("未连接 Core");
});
expect(remote.recoverableError).not.toHaveBeenCalled();
await act(async () => {
  window.dispatchEvent(new Event("pageshow"));
});
expect(poison.touches).not.toHaveBeenCalled();
expect(remote.host.textContent).toContain("未连接 Core");
await remote.unmount();
~~~

`MobilePresenceDomain.remote.test.tsx` 使用独立、真实的非回环 jsdom URL，加入 server-true + browser hostname rejection 的真实 evaluator/Provider/Domain/poison 组合；这条不能被 mock 或 server-false 测试替代。Vitest 4.1.10 会把 docblock JSON 自动包到当前 environment key 下，因此这里必须给 flat `url`，不能再嵌套 `jsdom`：

~~~tsx
/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://remote.example/mobile/presence"}
 */

it("keeps a server-trusted non-loopback browser outside Presence", async () => {
  expect(window.location.hostname).toBe("remote.example");
  const loopbackAuthority = await import("../authority/loopback-authority");
  const evaluator = vi.spyOn(
    loopbackAuthority,
    "isAllowedLoopbackHostname",
  );
  const {
    createDomainHydrationHarness,
    createPoisonOwner,
  } = await import("./presence-hydration.test-support");
  const hydration = createDomainHydrationHarness();
  const addEventListener = vi.spyOn(window, "addEventListener");
  const poison = createPoisonOwner();
  try {
    const remote = await hydration.hydrate(true, poison.owner);

    expect(remote.serverHtml).toContain("正在核验本机 Presence");
    await waitFor(() => {
      expect(remote.host.textContent).toContain("未连接 Core");
    });
    expect(remote.recoverableError).not.toHaveBeenCalled();
    expect(evaluator).toHaveBeenCalledWith("remote.example");
    expect(addEventListener).toHaveBeenCalledWith(
      "pageshow",
      expect.any(Function),
    );
    expect(poison.touches).not.toHaveBeenCalled();

    const callsBeforePageshow = evaluator.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => {
      expect(evaluator.mock.calls.length).toBeGreaterThan(callsBeforePageshow);
    });
    expect(remote.host.textContent).toContain("未连接 Core");
    expect(poison.touches).not.toHaveBeenCalled();
    await remote.unmount();
  } finally {
    await hydration.releaseAll();
    addEventListener.mockRestore();
    evaluator.mockRestore();
  }
});
~~~

trusted 测试传 createPresenceOwnerFixture(PRESENCE_CONTROLLER_SERVER_SNAPSHOT).owner，断言：

~~~tsx
const fixture = createPresenceOwnerFixture(
  PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
);
const hydrated = await hydration.hydrate(true, fixture.owner);
await waitFor(() => {
  expect(hydrated.host.querySelector("[aria-label='消息输入']")).not.toBeNull();
});
expect(hydrated.recoverableError).not.toHaveBeenCalled();
expect(fixture.activeSubscribers()).toBe(1);
expect(fixture.peakSubscribers()).toBe(1);
await hydrated.unmount();
expect(fixture.activeSubscribers()).toBe(0);
~~~

- [ ] **Step 6 — 运行 authority RED**

Run:

~~~powershell
npm test -- --run src/features/mobile/presence/MobilePresenceDomain.test.tsx src/features/mobile/presence/MobilePresenceDomain.remote.test.tsx
~~~

Expected: 两个文件都 FAIL because MobilePresenceDomain is missing；remote 文件的真实 `remote.example` 组合必须在任何 gate production 实现之前被执行并观察 RED。

- [ ] **Step 7 — 实现外门，禁止 hook**

MobilePresenceDomain.tsx：

~~~tsx
"use client";

import type { ReactNode } from "react";
import type { PresenceControllerOwner } from "@/features/presence/controller/use-presence-controller";
import { useMobileAuthority } from "../authority/MobileAuthorityProvider";
import { TrustedMobilePresenceDomain } from "./TrustedMobilePresenceDomain";
import styles from "./MobilePresenceDomain.module.css";

export interface MobilePresenceDomainProps {
  readonly owner?: PresenceControllerOwner;
}

export function MobilePresenceDomain({
  owner,
}: MobilePresenceDomainProps): ReactNode {
  const authority = useMobileAuthority();

  if (authority === "trusted-local") {
    return <TrustedMobilePresenceDomain owner={owner} />;
  }

  const checking = authority === "checking";
  return (
    <section className={styles.gate} data-mobile-presence-phase={authority}>
      <p className={styles.eyebrow}>PRESENCE / 主权中继</p>
      <h1>{checking ? "正在核验本机 Presence" : "未连接 Core"}</h1>
      <p>
        {checking
          ? "正在组合服务端目标与浏览器回环来源证据；核验完成前不会启动 Core、SSE 或语音。"
          : "当前来源或 Core 目标不是本机可信入口，未连接 Core，也未开放对话写入。"}
      </p>
    </section>
  );
}
~~~

此文件不得 import 或调用 usePresenceController。测试使用上一步已经由真实行为测试覆盖的 TrustedMobilePresenceDomain；不 mock trusted child。

同时只创建空的 `MobilePresenceDomain.module.css`，让模块解析成功；此时不要提前写 gate 样式。Run:

~~~powershell
npm test -- --run src/features/mobile/presence/MobilePresenceDomain.test.tsx src/features/mobile/presence/MobilePresenceDomain.remote.test.tsx
~~~

Expected: SSR、trusted/remote hydration、poison owner 与 pageshow 行为已 PASS；唯一剩余 RED 是 `locks the authority gate to a solid asymmetric surface` 缺少 `.gate` constitution。确认这一精确 RED 后才进入 Step 8。

- [ ] **Step 8 — 添加 gate 的纯色非卡片样式**

MobilePresenceDomain.module.css 初始内容：

~~~css
.gate {
  display: grid;
  min-inline-size: 0;
  max-inline-size: 52rem;
  gap: var(--space-4);
  padding-block: clamp(var(--space-6), 12dvh, var(--space-8));
  padding-inline: clamp(var(--space-3), 5vw, var(--space-7));
  border-block: 1px solid var(--astr-hairline-strong);
  border-inline-start: 3px solid var(--astr-soul);
  background: var(--astr-surface);
  color: var(--astr-text);
}

.gate h1,
.gate p {
  margin: 0;
  overflow-wrap: anywhere;
}

.gate h1 {
  max-inline-size: 14ch;
  font-family: var(--font-display);
  font-size: clamp(var(--type-3), 10vw, var(--type-5));
  line-height: var(--leading-display);
}

.gate p:not(.eyebrow) {
  max-inline-size: 42rem;
  color: var(--astr-text-2);
  font-size: var(--type-1);
  line-height: var(--leading-long);
}

.eyebrow {
  color: var(--astr-soul);
  font-family: var(--font-mono);
  font-size: var(--type--1);
  letter-spacing: 0.14em;
}
~~~

- [ ] **Step 9 — 运行 GREEN 与 source boundary**

Run:

~~~powershell
npm test -- --run src/features/mobile/authority src/features/mobile/presence
~~~

Expected: authority evaluator/provider、local/remote domain gate 与 trusted child core reuse 全部 PASS；remote test 以 `remote.example` 的真实 jsdom hostname 驱动真实 evaluator 和 Provider，组合证明 server false、server true + browser loopback、server true + browser rejection、poison owner 0 touch 与 pageshow evaluator call count 增长。

Run:

~~~powershell
rg -n "usePresenceController|PresenceExperience|SoulPresence|PresenceVisualHost|fetch\(|EventSource|transcribe\(" src/features/mobile/presence/MobilePresenceDomain.tsx
~~~

Expected: exit 1。

Run:

~~~powershell
npx eslint src/features/mobile/presence/MobilePresenceDomain.tsx src/features/mobile/presence/MobilePresenceDomain.test.tsx src/features/mobile/presence/MobilePresenceDomain.remote.test.tsx src/features/mobile/presence/TrustedMobilePresenceDomain.tsx src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx src/features/mobile/presence/presence.test-support.ts src/features/mobile/presence/presence-hydration.test-support.tsx
~~~

Expected: exit 0。

Run:

~~~powershell
npm run typecheck
~~~

Expected: exit 0。

- [ ] **Step 10 — 精确提交**

~~~powershell
git add -- webapp/src/features/mobile/presence/MobilePresenceDomain.tsx webapp/src/features/mobile/presence/MobilePresenceDomain.test.tsx webapp/src/features/mobile/presence/MobilePresenceDomain.remote.test.tsx webapp/src/features/mobile/presence/MobilePresenceDomain.module.css webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.tsx webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx webapp/src/features/mobile/presence/presence.test-support.ts webapp/src/features/mobile/presence/presence-hydration.test-support.tsx
git commit -m "feat: gate Mobile Presence by local authority"
~~~

---

### Task 4: 可信 Mobile Presence、宽阔聊天与静态星枢 Lens

**Files:**
- Modify: webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.tsx
- Modify: webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx
- Modify: webapp/src/features/mobile/presence/MobilePresenceDomain.test.tsx
- Modify: webapp/src/features/mobile/presence/MobilePresenceDomain.module.css

**Interfaces:**
- Consumes: usePresenceController(owner)、getFinalAnnouncementLedgerForScope(owner)、ConversationRegion、Composer、StaticSoulLens。
- Consumes test helper: createPresenceOwnerFixture(initialSnapshot: PresenceControllerSnapshot): PresenceOwnerFixture，返回 owner、actions、activeSubscribers()、peakSubscribers() 与 emit(next)。
- Produces:

~~~tsx
export interface TrustedMobilePresenceDomainProps {
  readonly owner?: PresenceControllerOwner;
}

export function TrustedMobilePresenceDomain(
  props: TrustedMobilePresenceDomainProps,
): ReactNode;
~~~

- [ ] **Step 1 — 写完整 immutable owner fixture**

TrustedMobilePresenceDomain.test.tsx 创建完整 snapshot，不省略真实接口字段：

~~~ts
function createSnapshot(
  overrides: Partial<PresenceControllerSnapshot> = {},
): PresenceControllerSnapshot {
  return Object.freeze({
    ...PRESENCE_CONTROLLER_SERVER_SNAPSHOT,
    semantic: Object.freeze({
      ...initialSemanticState,
      core: "reachable",
      replySse: "retrying",
      lifeSse: "open",
      conversation: "idle",
    }),
    status: Object.freeze({
      internalHandle: "sentinel_internal_handle",
      displayName: "  露怀秋  ",
      model: "sentinel_model",
      costTodayUsd: 123.45,
      dailyBudgetUsd: 999,
      emotion: Object.freeze({
        loneliness: 0,
        talkativeness: 0,
        irritation: 0,
        excitement: 0,
      }),
      activity: "正在整理今天的记忆",
    }),
    conversation: Object.freeze({
      messages: Object.freeze([]),
      receipt: null,
      provisionalText: "",
      provisionalActive: false,
      authoritativeDecision: null,
      error: null,
    }),
    draft: Object.freeze({
      revision: 0,
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    }),
    lifeEvents: Object.freeze([]),
    diagnostics: Object.freeze([]),
    ...overrides,
  });
}
~~~

本测试从 ./presence.test-support 导入 createPresenceOwnerFixture；不得在第二个测试文件复制或缩减 owner。helper 已保存 listeners、activeSubscribers、peakSubscribers、emit(next)，六个 actions 都是稳定函数；getSnapshot 与 getServerSnapshot 返回缓存对象。

- [ ] **Step 2 — 写真值、隐私与复用 RED**

加入真实 AppShell 集成测试：

~~~tsx
it("renders independent Core and stream facts, real conversation, and the sole global announcer", () => {
  const fixture = createPresenceOwnerFixture(createSnapshot());
  const { container } = render(
    <AppShell>
      <main id="main-content">
        <TrustedMobilePresenceDomain owner={fixture.owner} />
      </main>
    </AppShell>,
  );

  expect(screen.getByRole("heading", { level: 1, name: "与 露怀秋 对话" })).toBeVisible();
  const facts = screen.getByRole("group", { name: "Presence 连接事实" });
  expect(within(within(facts).getByText("Core").closest("div")!).getByText("可达"))
    .toBeVisible();
  expect(
    within(within(facts).getByText("Reply SSE").closest("div")!).getByText("重连中"),
  ).toBeVisible();
  expect(
    within(within(facts).getByText("Life SSE").closest("div")!).getByText("已连接"),
  ).toBeVisible();
  expect(screen.getByText("此刻：正在整理今天的记忆")).toBeVisible();
  expect(screen.getByRole("region", { name: "对话记录" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "消息输入" })).toBeVisible();
  expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  expect(container.innerHTML).not.toContain("sentinel_internal_handle");
  expect(container.innerHTML).not.toContain("sentinel_model");
  expect(container.innerHTML).not.toContain("123.45");
  expect(container.innerHTML).not.toContain("999");
});
~~~

加入完整映射测试；Reply 与 Life 每行使用不同值，并把 conversation 固定为 final，证明 stream 文案不从 conversation 推断：

~~~tsx
it.each([
  ["cold", "未启动"],
  ["loading", "核验中"],
  ["reachable", "可达"],
  ["offline", "离线"],
  ["error", "状态错误"],
] as const)("maps Core %s to %s", (core, expected) => {
  const fixture = createPresenceOwnerFixture(
    createSnapshot({
      semantic: Object.freeze({
        ...initialSemanticState,
        core,
        replySse: "open",
        lifeSse: "closed",
        conversation: "final",
      }),
    }),
  );
  render(<TrustedMobilePresenceDomain owner={fixture.owner} />);
  const fact = screen.getByText("Core").closest("div");
  expect(fact).not.toBeNull();
  expect(within(fact!).getByText(expected)).toBeVisible();
});

it.each([
  ["connecting", "open", "连接中", "已连接"],
  ["open", "retrying", "已连接", "重连中"],
  ["retrying", "closed", "重连中", "未连接"],
  ["closed", "connecting", "未连接", "连接中"],
] as const)(
  "keeps Reply %s and Life %s independent from final conversation",
  (replySse, lifeSse, replyCopy, lifeCopy) => {
    const fixture = createPresenceOwnerFixture(
      createSnapshot({
        semantic: Object.freeze({
          ...initialSemanticState,
          core: "reachable",
          replySse,
          lifeSse,
          conversation: "final",
        }),
      }),
    );
    render(<TrustedMobilePresenceDomain owner={fixture.owner} />);
    const replyFact = screen.getByText("Reply SSE").closest("div");
    const lifeFact = screen.getByText("Life SSE").closest("div");
    expect(within(replyFact!).getByText(replyCopy)).toBeVisible();
    expect(within(lifeFact!).getByText(lifeCopy)).toBeVisible();
  },
);
~~~

加入：

~~~tsx
it.each(["cold", "loading", "offline", "error"] as const)(
  "marks retained activity stale while Core is %s",
  (core) => {
    const fixture = createPresenceOwnerFixture(
      createSnapshot({
        semantic: Object.freeze({
          ...initialSemanticState,
          core,
          replySse: "closed",
          lifeSse: "closed",
          conversation: "idle",
        }),
      }),
    );
    render(<TrustedMobilePresenceDomain owner={fixture.owner} />);
    expect(
      screen.getByText("最近一次：正在整理今天的记忆（可能陈旧）"),
    ).toBeVisible();
  },
);

it.each([undefined, "", "   "])(
  "falls back to Soul and Core 未提供 without leaking the internal handle",
  (displayName) => {
    const base = createSnapshot();
    const fixture = createPresenceOwnerFixture(
      createSnapshot({
        status: Object.freeze({
          ...base.status!,
          displayName,
          activity: "   ",
        }),
      }),
    );
    const { container } = render(
      <TrustedMobilePresenceDomain owner={fixture.owner} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "与 Soul 对话" })).toBeVisible();
    expect(screen.getByText("Core 未提供")).toBeVisible();
    expect(container.innerHTML).not.toContain("sentinel_internal_handle");
  },
);
~~~

- [ ] **Step 3 — 写 50 消息、上滚与 final takeover RED**

stub scrollHeight=1000、clientHeight=200。构造 50 条消息，先断言全部在 role=list 的真实 ConversationRegion 内。用户把 viewport.scrollTop 设为 100 并 fireEvent.scroll；fixture.emit 新 provisional 与同 key final 后：

- viewport.scrollTop 仍为 100；
- 出现 回到最新 与真实未读计数；
- final event 只进入 semanticStore announce 一次；
- 点击 回到最新 后 scrollTop=scrollHeight-clientHeight，viewport 获得 focus。

实际测试骨架：

~~~tsx
it("keeps a 50-message reader in place through stream and same-key final takeover", () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1_000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  const announce = vi.spyOn(semanticStore.getState(), "announce");
  const messages = Object.freeze(
    Array.from({ length: 50 }, (_, index) => ({
      id: "mobile-history-" + index,
      role: "user" as const,
      text: "历史消息 " + index,
      ts: Date.UTC(2026, 6, 14, 0, index),
    })),
  );
  const fixture = createPresenceOwnerFixture(
    createSnapshot({
      conversation: Object.freeze({
        messages,
        receipt: null,
        provisionalText: "",
        provisionalActive: false,
        authoritativeDecision: null,
        error: null,
      }),
    }),
  );

  const { container } = render(
    <AppShell>
      <main id="main-content">
        <TrustedMobilePresenceDomain owner={fixture.owner} />
      </main>
    </AppShell>,
  );
  expect(within(screen.getByRole("list", { name: "对话消息" }))
    .getAllByRole("listitem")).toHaveLength(50);
  expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);

  const viewport = screen.getByRole("region", { name: "对话记录" });
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);

  act(() => {
    fixture.emit(
      createSnapshot({
        conversation: Object.freeze({
          messages,
          receipt: Object.freeze({
            event_id: "mobile-ingest",
            trace_id: "mobile-trace",
          }),
          provisionalText: "流式回复",
          provisionalActive: true,
          authoritativeDecision: null,
          error: null,
        }),
      }),
    );
  });
  expect(viewport.scrollTop).toBe(100);
  expect(
    screen.getByRole("button", { name: "回到最新，1 条未读更新" }),
  ).toBeVisible();

  act(() => {
    fixture.emit(
      createSnapshot({
        conversation: Object.freeze({
          messages: Object.freeze([
            ...messages,
            {
              id: "reply:mobile-trace",
              role: "qiuqiu" as const,
              text: "权威终稿",
              ts: Date.UTC(2026, 6, 14, 1, 0),
              traceId: "mobile-trace",
              eventId: "mobile-final",
            },
          ]),
          receipt: Object.freeze({
            event_id: "mobile-ingest",
            trace_id: "mobile-trace",
          }),
          provisionalText: "",
          provisionalActive: false,
          authoritativeDecision: null,
          error: null,
        }),
      }),
    );
  });
  expect(viewport.scrollTop).toBe(100);
  expect(announce).toHaveBeenCalledTimes(1);

  fireEvent.click(
    screen.getByRole("button", { name: "回到最新，1 条未读更新" }),
  );
  expect(viewport.scrollTop).toBe(800);
  expect(viewport).toHaveFocus();
});
~~~

测试文件使用：

~~~ts
beforeEach(() => {
  semanticStore.setState({ ...initialSemanticState, announcement: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => {
    semanticStore.setState({ ...initialSemanticState, announcement: null });
  });
});
~~~

这个测试不得复制 ConversationRegion 算法，只通过 owner.emit 驱动真实共享组件。

- [ ] **Step 4 — 写 Lens / CSS / dependency RED**

读取 TrustedMobilePresenceDomain.tsx、MobilePresenceDomain.module.css、Composer.module.css 与 PresenceTimelines.module.css，断言：

~~~ts
const source = readFileSync(
  resolve(
    process.cwd(),
    "src/features/mobile/presence/TrustedMobilePresenceDomain.tsx",
  ),
  "utf8",
);
const css = readFileSync(
  resolve(
    process.cwd(),
    "src/features/mobile/presence/MobilePresenceDomain.module.css",
  ),
  "utf8",
);
const composerCss = readFileSync(
  resolve(
    process.cwd(),
    "src/features/presence/components/Composer.module.css",
  ),
  "utf8",
);
const timelineCss = readFileSync(
  resolve(
    process.cwd(),
    "src/features/presence/components/PresenceTimelines.module.css",
  ),
  "utf8",
);
expect(source).toContain('from "@/features/presence/components/ConversationRegion"');
expect(source).toContain('from "@/features/presence/components/Composer"');
expect(source).not.toMatch(/MessageTimeline|projectConversationTimeline/);
expect(source).not.toMatch(
  /PresenceExperience|SoulPresence|PresenceVisualHost|PresenceVisibilityBridge|JewelRuntime|pixi|live2d|three|webgl|framer-motion|canvas|getContext|requestAnimationFrame/i,
);
expect(source).not.toMatch(/internalHandle|model|costTodayUsd|dailyBudgetUsd/);
expect(source).not.toMatch(/safety|guard|task|dispatch|device|approval/i);
const dialogueRule = css.match(/\.dialogueSurface\s*\{([^}]*)\}/s)?.[1];
const soulMarkRule = css.match(/\.soulMark\s*\{([^}]*)\}/s)?.[1];
expect(dialogueRule).toBeDefined();
expect(soulMarkRule).toBeDefined();
expect(soulMarkRule).toContain("position: relative");
expect(soulMarkRule).toContain("flex: none");
expect(soulMarkRule).not.toMatch(/\binset(?:-|\s*:)|z-index|transform/);
expect(dialogueRule).toMatch(/block-size:\s*clamp\([\s\S]*100dvh/);
expect(dialogueRule).toMatch(
  /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/,
);
expect(dialogueRule).toContain("min-block-size: 0");
expect(dialogueRule).toContain("min-inline-size: 0");
expect(dialogueRule).toContain("overflow: visible");
expect(dialogueRule).toContain("var(--mobile-nav-block-size, 5.25rem)");
expect(dialogueRule).toContain("env(safe-area-inset-bottom)");
expect(dialogueRule).toContain(
  "--astr-composer-max-block-size: min(42%, 21rem)",
);
expect(dialogueRule).toContain("--astr-composer-overflow-y: auto");
expect(css).toMatch(/\.lens\s+:global\(\.lensOuter\)[\s\S]*fill:\s*none/);
expect(css).toMatch(/\.lens\s+:global\(\.lensFacet\)[\s\S]*fill:\s*var\(--astr-surface-2\)/);
expect(css).toMatch(/\.lens\s+:global\(\.lensCore\)[\s\S]*fill:\s*var\(--astr-soul\)/);
expect(css).not.toMatch(
  /gradient|backdrop-filter|filter\s*:|box-shadow|@keyframes|animation\s*:|\bgreen\b|\blime\b|\bemerald\b|\bchartreuse\b/i,
);
expect(composerCss).not.toMatch(/gradient/i);
expect(composerCss).toMatch(
  /box-shadow:\s*var\(\s*--astr-composer-shadow,\s*none\s*\)/,
);
expect(composerCss).toMatch(
  /max-block-size:\s*var\(\s*--astr-composer-max-block-size,\s*none\s*\)/,
);
expect(composerCss).toMatch(
  /overflow-y:\s*var\(\s*--astr-composer-overflow-y,\s*visible\s*\)/,
);
expect(timelineCss).toMatch(
  /box-shadow:\s*var\(\s*--astr-timeline-assistant-shadow,\s*none\s*\)/,
);
expect(timelineCss).toMatch(
  /box-shadow:\s*var\(\s*--astr-timeline-return-shadow,\s*none\s*\)/,
);
expect(css).toMatch(
  /\.statusRail\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
);
expect(css).not.toMatch(
  /\.statusRail\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
);
expect(css).toMatch(/@media\s*\(max-width:\s*44rem\)/);
expect(css).toMatch(/@media\s*\(max-width:\s*25rem\)/);
expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
~~~

DOM 断言两个装饰 SVG 都 aria-hidden=true、focusable=false；Lens child paths 由 CSS 明确 fill，不能依赖 SVG 默认黑色。并锁定 Jewel 属于对话边缘而非占据 Hero：

~~~tsx
const dialogue = screen.getByRole("region", { name: "Mobile Presence 对话" });
expect(dialogue.querySelector("[data-mobile-soul-mark]")).not.toBeNull();
expect(
  screen.getByRole("heading", { level: 2, name: "对话" }).closest("header")
    ?.querySelector("[data-mobile-soul-mark]"),
).not.toBeNull();
const decorativeSvgs = dialogue.querySelectorAll(
  "[data-mobile-soul-mark] svg",
);
expect(decorativeSvgs).toHaveLength(2);
for (const svg of decorativeSvgs) {
  expect(svg).toHaveAttribute("aria-hidden", "true");
  expect(svg).toHaveAttribute("focusable", "false");
}
expect(
  screen.getByRole("heading", { level: 1 }).closest("header")
    ?.querySelector("[data-mobile-soul-mark]"),
).toBeNull();
~~~

再用 diagnostics 非空、conversation.error 非空的 snapshot 渲染真实 Composer：

~~~tsx
it("keeps expanded Composer diagnostics reachable instead of clipping them", () => {
  const base = createSnapshot();
  const relatedDiagnostics = Object.freeze([
    ...Array.from({ length: 20 }, (_, index) => ({
      code: "UNBOUND_STREAM_DROPPED" as const,
      message: "unbound stream " + index,
      at: index,
      eventId: "unbound-" + index,
      traceId: "trace-" + index,
    })),
    {
      code: "INGEST_FAILED" as const,
      message: "ingest failed",
      at: 42,
    },
  ]);
  const fixture = createPresenceOwnerFixture(
    createSnapshot({
      conversation: Object.freeze({
        ...base.conversation,
        error: "ingest failed",
      }),
      diagnostics: relatedDiagnostics,
    }),
  );
  render(<TrustedMobilePresenceDomain owner={fixture.owner} />);
  fireEvent.click(screen.getByRole("button", { name: /诊断详情/ }));
  const diagnostics = screen.getByRole("list", { name: "最近相关诊断" });
  expect(diagnostics).toBeVisible();
  expect(within(diagnostics).getAllByRole("listitem")).toHaveLength(21);
});
~~~

结合 dialogueRule 的 `overflow: visible` 与 Composer 的 Mobile-only `max-block-size / overflow-y:auto` 锁定：展开内容在 Composer 内可滚动、不会被 Mobile 外壳裁掉，同时消息 viewport 保持构图主体。textarea 保留现有 resize: vertical，Mobile 不以 CSS 禁用既有 Composer 能力。

- [ ] **Step 5 — 运行全部 RED**

Run:

~~~powershell
npm test -- --run src/features/mobile/presence
~~~

Expected: FAIL 于缺少状态真值、Lens、确定高度或 CSS 合同。

- [ ] **Step 6 — 实现可信投影**

TrustedMobilePresenceDomain.tsx 使用以下完整结构；helper 只做纯映射：

~~~tsx
"use client";

import type { ReactNode } from "react";
import { Composer } from "@/features/presence/components/Composer";
import {
  ConversationRegion,
  getFinalAnnouncementLedgerForScope,
} from "@/features/presence/components/ConversationRegion";
import { StaticSoulLens } from "@/features/presence/components/StaticSoulLens";
import {
  presenceControllerOwner,
  usePresenceController,
  type PresenceControllerOwner,
} from "@/features/presence/controller/use-presence-controller";
import type { CoreState, StreamState } from "@/lib/semantic-state";
import styles from "./MobilePresenceDomain.module.css";

const CORE_COPY: Readonly<Record<CoreState, string>> = Object.freeze({
  cold: "未启动",
  loading: "核验中",
  reachable: "可达",
  offline: "离线",
  error: "状态错误",
});

const STREAM_COPY: Readonly<Record<StreamState, string>> = Object.freeze({
  connecting: "连接中",
  open: "已连接",
  retrying: "重连中",
  closed: "未连接",
});

export interface TrustedMobilePresenceDomainProps {
  readonly owner?: PresenceControllerOwner;
}

export function TrustedMobilePresenceDomain({
  owner = presenceControllerOwner,
}: TrustedMobilePresenceDomainProps): ReactNode {
  const { snapshot, actions } = usePresenceController(owner);
  const assistantLabel = nonblank(snapshot.status?.displayName) ?? "Soul";
  const activity = activityCopy(
    snapshot.status?.activity,
    snapshot.semantic.core,
  );

  return (
    <section className={styles.domain}>
      <header className={styles.hero}>
        <div className={styles.titleRail}>
          <p className={styles.eyebrow}>PRESENCE / 灵魂中继</p>
          <h1>与 {assistantLabel} 对话</h1>
          <p className={styles.activity}>{activity}</p>
        </div>
      </header>

      <dl
        aria-label="Presence 连接事实"
        className={styles.statusRail}
        role="group"
      >
        <div>
          <dt>Core</dt>
          <dd>{CORE_COPY[snapshot.semantic.core]}</dd>
        </div>
        <div>
          <dt>Reply SSE</dt>
          <dd>{STREAM_COPY[snapshot.semantic.replySse]}</dd>
        </div>
        <div>
          <dt>Life SSE</dt>
          <dd>{STREAM_COPY[snapshot.semantic.lifeSse]}</dd>
        </div>
      </dl>

      <section
        aria-label="Mobile Presence 对话"
        className={styles.dialogueSurface}
        role="region"
      >
        <ConversationRegion
          announcementLedger={getFinalAnnouncementLedgerForScope(owner)}
          assistantLabel={assistantLabel}
          conversation={snapshot.conversation}
          headerAction={
            <div
              aria-hidden="true"
              className={styles.soulMark}
              data-mobile-soul-mark=""
            >
              <svg
                aria-hidden="true"
                className={styles.sCurve}
                focusable="false"
                viewBox="0 0 120 220"
              >
                <path d="M90 12 C20 42 24 94 72 108 C116 121 100 182 28 208" />
              </svg>
              <StaticSoulLens className={styles.lens} />
            </div>
          }
        />
        <Composer
          actions={actions}
          snapshot={{
            conversation: snapshot.conversation,
            diagnostics: snapshot.diagnostics,
            draft: snapshot.draft,
            semantic: snapshot.semantic,
          }}
        />
      </section>
    </section>
  );
}

function nonblank(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function activityCopy(
  value: string | undefined,
  core: CoreState,
): string {
  const activity = nonblank(value);
  if (!activity) return "Core 未提供";
  if (core === "reachable") return "此刻：" + activity;
  return "最近一次：" + activity + "（可能陈旧）";
}
~~~

不得读取 snapshot.status 的其他字段。

- [ ] **Step 7 — 完成非矩形但克制的 Mobile CSS**

在现有 gate CSS 后追加。关键规则精确如下，其余 spacing 使用现有 tokens：

~~~css
.domain {
  display: grid;
  min-inline-size: 0;
  gap: clamp(var(--space-4), 4vw, var(--space-6));
  color: var(--astr-text);
}

.hero {
  position: relative;
  min-inline-size: 0;
  padding-block-end: var(--space-3);
  border-block-end: 1px solid var(--astr-hairline-strong);
}

.titleRail,
.titleRail h1,
.titleRail p {
  min-inline-size: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.titleRail {
  display: grid;
  gap: var(--space-2);
}

.titleRail h1 {
  max-inline-size: 12ch;
  font-family: var(--font-display);
  font-size: clamp(var(--type-3), 9vw, var(--type-5));
  font-weight: 600;
  line-height: var(--leading-display);
  letter-spacing: -0.035em;
}

.activity {
  max-inline-size: 42rem;
  color: var(--astr-text-2);
  font-size: var(--type-1);
  line-height: var(--leading-long);
}

.soulMark {
  position: relative;
  flex: none;
  inline-size: clamp(3.75rem, 12vw, 5rem);
  block-size: 3.75rem;
  overflow: hidden;
  pointer-events: none;
}

.sCurve,
.lens {
  position: absolute;
  inline-size: 100%;
}

.sCurve {
  inset: -2.25rem 0 auto;
  block-size: 7rem;
}

.sCurve path {
  fill: none;
  stroke: var(--astr-action);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.lens {
  inset: -0.25rem 0 auto auto;
  inline-size: clamp(3.25rem, 10vw, 4.25rem);
  block-size: auto;
}

.lens :global(.lensOuter),
.lens :global(.lensContinuity),
.lens :global(.lensShell),
.lens :global(.lensNotch),
.lens :global(.lensAxis) {
  fill: none;
  stroke: var(--astr-hairline-strong);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.lens :global(.lensFacet) {
  fill: var(--astr-surface-2);
  stroke: var(--astr-soul);
  stroke-width: 1;
}

.lens :global(.lensCore) {
  fill: var(--astr-soul);
  stroke: var(--astr-text);
  stroke-width: 1;
}

.statusRail {
  display: grid;
  min-inline-size: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  border-block: 1px solid var(--astr-hairline-strong);
}

.statusRail > div {
  display: grid;
  min-inline-size: 0;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
}

.statusRail > div + div {
  border-inline-start: 1px solid var(--astr-hairline);
}

.statusRail dt,
.statusRail dd {
  min-inline-size: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.statusRail dt {
  color: var(--astr-text-3);
  font-family: var(--font-mono);
  font-size: var(--type--1);
  letter-spacing: 0.08em;
}

.statusRail dd {
  color: var(--astr-text);
  font-size: var(--type-1);
}

.dialogueSurface {
  --astr-composer-max-block-size: min(42%, 21rem);
  --astr-composer-overflow-y: auto;
  position: relative;
  display: grid;
  min-block-size: 0;
  min-inline-size: 0;
  block-size: clamp(
    34rem,
    calc(
      100dvh
      - var(--mobile-nav-block-size, 5.25rem)
      - env(safe-area-inset-bottom)
      - 14rem
    ),
    52rem
  );
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: visible;
  gap: var(--space-3);
  padding: clamp(var(--space-3), 3vw, var(--space-5));
  border-block-start: 1px solid var(--astr-action);
  border-block-end: 1px solid var(--astr-hairline-strong);
  border-inline-start: 3px solid var(--astr-soul);
  background: var(--astr-surface);
}

@media (max-width: 44rem) {
  .statusRail > div {
    padding: var(--space-2);
  }
}

@media (max-width: 25rem) {
  .statusRail dt {
    letter-spacing: 0.03em;
  }

  .dialogueSurface {
    padding-inline: var(--space-2);
  }
}
~~~

不要设置 `--astr-composer-surface`、`--astr-composer-accent-line`、`--astr-composer-shadow` 或 `--astr-timeline-*` skin tokens；Mobile 应自然命中 shared none / solid fallback。只设置上述两个 Composer layout guards。

- [ ] **Step 8 — 回归真实 authority hydration 集成**

保持 Task 3 已使用的真实 TrustedMobilePresenceDomain，不引入 child mock。用稳定 fake owner hydrate trusted tree：

- SSR HTML 是 checking，owner 0 调用；
- hydration 后 textbox 可见；
- activeSubscribers === 1；
- onRecoverableError 0；
- root.unmount 后 activeSubscribers === 0；
- remote hydration + pageshow 后 owner 所有方法仍 0。

测试树不包 StrictMode，因此同时断言 peakSubscribers() === 1、稳定后 activeSubscribers() === 1、卸载后为 0。既有 use-presence-controller StrictMode suite 继续负责开发期 acquire/release 语义。

- [ ] **Step 9 — 运行 focused GREEN**

Run:

~~~powershell
npm test -- --run src/features/mobile/presence
~~~

Expected: all PASS。

Run:

~~~powershell
npm test -- --run src/features/presence/components/ConversationRegion.test.tsx src/features/presence/components/Composer.test.tsx src/features/presence/PresenceExperience.test.tsx
~~~

Expected: all shared desktop regression PASS。

- [ ] **Step 10 — 运行依赖、视觉、类型与 lint 边界**

Run:

~~~powershell
rg -n -i "PresenceExperience|SoulPresence|PresenceVisualHost|PresenceVisibilityBridge|pixi|live2d|JewelRuntime|three|webgl|framer-motion|canvas|getContext|requestAnimationFrame|requestIdleCallback|TaskSnapshot|DeviceSnapshot|DispatchClient" src/features/mobile/presence --glob "!*.test.*" --glob "!*.test-support.*"
~~~

Expected: exit 1。

Run:

~~~powershell
rg -n -i "gradient|backdrop-filter|filter\s*:|box-shadow|@keyframes|animation\s*:|\bgreen\b|\blime\b|\bemerald\b|\bchartreuse\b" src/features/mobile/presence --glob "*.css"
~~~

Expected: exit 1。

Run:

~~~powershell
npx eslint src/features/mobile/presence src/features/presence/components/ConversationRegion.tsx src/features/presence/components/ConversationRegion.test.tsx
~~~

Expected: exit 0。

Run:

~~~powershell
npm run typecheck
~~~

Expected: exit 0。

- [ ] **Step 11 — 精确提交**

~~~powershell
git add -- webapp/src/features/mobile/presence/MobilePresenceDomain.test.tsx webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.tsx webapp/src/features/mobile/presence/TrustedMobilePresenceDomain.test.tsx webapp/src/features/mobile/presence/MobilePresenceDomain.module.css
git commit -m "feat: project trusted Presence into Mobile"
~~~

---

### Task 5: Presence tranche 验证与审查闭环

**Files:**
- Verify only: all files from Tasks 1–4
- Update ignored ledger: .superpowers/sdd/progress.md

**Interfaces:**
- Produces reviewed Mobile Presence tranche，供后续 route assembly 消费 MobilePresenceDomain。

- [ ] **Step 1 — 运行 fresh focused suite**

~~~powershell
npm test -- --run src/features/mobile/presence src/features/presence/components/ConversationRegion.test.tsx src/features/presence/components/Composer.test.tsx src/features/presence/PresenceExperience.test.tsx
~~~

Expected: all PASS，输出无 warning。

- [ ] **Step 2 — 运行 Tasks + authority 邻接回归**

~~~powershell
npm test -- --run src/features/mobile/authority src/features/mobile/tasks
~~~

Expected: all PASS。

- [ ] **Step 3 — 运行静态质量门**

~~~powershell
npm run lint
~~~

Expected: exit 0。

~~~powershell
npm run typecheck
~~~

Expected: exit 0。

- [ ] **Step 4 — 独立规格审查**

审查者逐条核对：

- checking / remote 的 poison owner 0 touch；
- trusted exactly one active subscription，unmount 0；
- shared ledger 同 owner 跨实例 / remount 去重且容量 256；
- viewport scroll state 不共享；
- 5 Core × 4 stream 映射独立，stale activity 真实；
- internalHandle / model / cost / budget 零泄漏；
- ConversationRegion / Composer 行为复用；
- Mobile CSS 无 gradient / glow / animation / green / heavy visual；
- definite chat height、50 message、上滚、return latest 与唯一 global announcer。

Critical / Important / Minor 都必须在本 tranche 修复并复审至 0；只有审查者明确标为跨 tranche、且不属于本计划任何文件/合同的观察项才可按原严重度记入总 progress backlog，不能把本 tranche 的实际 M>0 写成 M0。

- [ ] **Step 5 — 更新 durable progress，不虚报浏览器验收**

在 .superpowers/sdd/progress.md 追加实际 commits、测试数量与经复审确认的 C0/I0/M0 结果，并逐字带上：

~~~text
Mobile Presence component tranche: complete; route-level dark/light × 320/390/430/768, 200%/400% zoom, soft-keyboard, axe, real overflow, screenshots and performance budgets remain pending until Mobile route assembly/browser acceptance.
~~~

此文件保持 ignored，不提交。只有后续真实浏览器命令与产物能删除 pending；source regex 或 unit PASS 不能替代。

## 计划自审结论

- Spec coverage：authority、truth、privacy、reuse、chat geometry、scroll、announcement、visual isolation、a11y 与依赖边界均有明确任务和证据。
- Completeness scan：所有代码步骤均给出确定接口、取值与验证证据。
- Type consistency：MobilePresenceDomain 与 TrustedMobilePresenceDomain 的 owner 都是同一 PresenceControllerOwner；ledger scope 使用同一 owner object identity；CoreState / StreamState 来自现有 semantic-state。
- Scope：仅完成 W4 Presence tranche；不提前实现路由装配、Safety、Workbench、Knowledge 或 Secure Dispatch。
- Pre-flight conflict：Task 3 先以真实测试建立最小 trusted child，再建立外门；Task 4 在新 RED 下扩充同一 child，不存在缺失模块、测试替身冒充产品或生产代码先于测试的问题。
