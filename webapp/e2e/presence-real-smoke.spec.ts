import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const NAMED_SSE_EVENTS = [
  "agent.thought",
  "soul.stream",
  "soul.decision",
  "presentation.express",
  "moa.report",
] as const;

interface NamedEventObservation {
  readonly status: "passed" | "failed";
  readonly eventName: string;
  readonly notes: string;
}

test("observes the explicitly configured real Core through read-only GET and SSE traffic", async ({
  page,
}) => {
  const mutationRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      mutationRequests.push(`${request.method()} ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await page.addInitScript((eventNames) => {
    const observations: NamedEventObservation[] = [];
    Object.defineProperty(window, "__astrNamedSseEventObservations", {
      configurable: true,
      value: observations,
    });
    const NativeEventSource = window.EventSource;
    class ObservedEventSource extends NativeEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict);
        for (const eventName of eventNames) {
          super.addEventListener(eventName, (event) => {
            const data = (event as MessageEvent<unknown>).data;
            try {
              const parsed = typeof data === "string" ? JSON.parse(data) : null;
              const valid =
                parsed !== null &&
                typeof parsed === "object" &&
                !Array.isArray(parsed) &&
                typeof parsed.id === "string" &&
                parsed.id.length > 0 &&
                typeof parsed.ts === "string" &&
                parsed.ts.length > 0 &&
                parsed.type === eventName &&
                typeof parsed.source === "string" &&
                parsed.source.length > 0 &&
                typeof parsed.trace_id === "string" &&
                parsed.trace_id.length > 0 &&
                parsed.payload !== null &&
                typeof parsed.payload === "object" &&
                !Array.isArray(parsed.payload);
              observations.push({
                status: valid ? "passed" : "failed",
                eventName,
                notes: valid
                  ? `Observed and parsed ${eventName} from the configured Core.`
                  : `${eventName} did not match the named ASTR event shape.`,
              });
            } catch (error) {
              observations.push({
                status: "failed",
                eventName,
                notes: `${eventName} contained invalid JSON: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              });
            }
          });
        }
      }
    }
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: ObservedEventSource,
    });
  }, NAMED_SSE_EVENTS);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const main = page.locator("main#main-content");
  await expect(main).toBeVisible();
  await expect(main).toHaveAttribute("data-sse-state", "reply:open|life:open");
  await expect(page.getByRole("group", { name: "Core 状态" })).not.toContainText(
    "检查中",
  );
  expect(mutationRequests).toEqual([]);

  await page.waitForFunction(
    () =>
      (
        window as Window & {
          __astrNamedSseEventObservations?: NamedEventObservation[];
        }
      ).__astrNamedSseEventObservations?.some(({ status }) => status === "passed") === true,
    undefined,
    { timeout: 2_000 },
  ).catch(() => undefined);
  const observations = await page.evaluate(
    () =>
      (
        window as Window & {
          __astrNamedSseEventObservations?: NamedEventObservation[];
        }
      ).__astrNamedSseEventObservations ?? [],
  );
  const evidence = observations.find(({ status }) => status === "passed") ??
    observations[0] ?? {
      status: "not-run",
      notes: "No named SSE event was observed during the passive read-only window.",
    };
  const evidencePath = resolve(
    process.env.ASTR_REAL_CORE_NAMED_EVENT_EVIDENCE_PATH ??
      "test-results/presence-evidence/real-core-named-sse-event.json",
  );
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
});
