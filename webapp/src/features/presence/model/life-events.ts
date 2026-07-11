import type { AstrEvent } from "@/lib/types";

export const LIFE_SUMMARY_CAPACITY = 60;
export const LIFE_PROJECTION_DIAGNOSTIC_CAPACITY = 32;

const SUPPORTED_LIFE_EVENT_TYPES = new Set([
  "agent.thought",
  "moa.report",
  "soul.decision",
] as const);

const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([zZ]|([+-])(\d{2}):(\d{2}))$/;

export type LifeEventType = "agent.thought" | "moa.report" | "soul.decision";

export interface LifeSummary {
  readonly id: string;
  readonly eventType: LifeEventType;
  readonly kind: "processing" | "record";
  readonly label: "处理片段" | "生活记录";
  readonly text: string;
  readonly source: string;
  readonly occurredAt: string | null;
}

export interface CurrentLifeActivity {
  readonly text: string;
  readonly source: "Core status";
  readonly occurredAt: null;
}

export interface LifeProjectionDiagnostic {
  readonly code: "MALFORMED_LIFE_PAYLOAD";
  readonly eventId: string;
  readonly eventType: LifeEventType;
  readonly message: string;
}

export interface LifeProjection {
  readonly currentActivity: CurrentLifeActivity | null;
  readonly summaries: readonly LifeSummary[];
  readonly diagnostics: readonly LifeProjectionDiagnostic[];
  readonly malformedCount: number;
}

export interface UtcTimestampPresentation {
  readonly dateTime: string;
  readonly label: string;
}

export function projectLifeEvents(
  events: readonly AstrEvent[],
  activity?: string,
): LifeProjection {
  const seenIds = new Set<string>();
  const summaries: LifeSummary[] = [];
  const diagnostics: LifeProjectionDiagnostic[] = [];
  let malformedCount = 0;

  for (const event of events) {
    if (!isSupportedLifeEventType(event.type)) continue;
    if (!isNonBlankString(event.id) || seenIds.has(event.id)) continue;
    seenIds.add(event.id);

    const field = payloadTextField(event.type);
    const text = readOwnNonBlankString(event.payload, field);
    if (text === null) {
      malformedCount += 1;
      diagnostics.push({
        code: "MALFORMED_LIFE_PAYLOAD",
        eventId: event.id,
        eventType: event.type,
        message: `${event.type} did not provide an own non-blank ${field} field.`,
      });
      continue;
    }

    const record = event.type === "soul.decision";
    summaries.push({
      id: event.id,
      eventType: event.type,
      kind: record ? "record" : "processing",
      label: record ? "生活记录" : "处理片段",
      text,
      source: isNonBlankString(event.source) ? event.source.trim() : "来源未提供",
      occurredAt: formatUtcTimestamp(event.ts)?.dateTime ?? null,
    });
  }

  const activityText = isNonBlankString(activity) ? activity.trim() : null;
  return {
    currentActivity:
      activityText === null
        ? null
        : { text: activityText, source: "Core status", occurredAt: null },
    summaries: summaries.slice(-LIFE_SUMMARY_CAPACITY),
    diagnostics: diagnostics.slice(-LIFE_PROJECTION_DIAGNOSTIC_CAPACITY),
    malformedCount,
  };
}

export function formatUtcTimestamp(
  value: string | number,
): UtcTimestampPresentation | null {
  let normalized: string | number = value;
  if (typeof value === "string") {
    const match = RFC3339_TIMESTAMP.exec(value);
    if (!match) return null;
    const components = match.slice(1, 7).map(Number);
    const [year, month, day, hour, minute, second] = components;
    if (
      year === undefined ||
      month === undefined ||
      day === undefined ||
      hour === undefined ||
      minute === undefined ||
      second === undefined ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > daysInMonth(year, month) ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return null;
    }
    const offsetHour = match[10];
    const offsetMinute = match[11];
    if (
      (offsetHour !== undefined && Number(offsetHour) > 23) ||
      (offsetMinute !== undefined && Number(offsetMinute) > 59)
    ) {
      return null;
    }
    normalized = value.replace("t", "T").replace("z", "Z");
  }
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return null;
  const dateTime = date.toISOString();
  return {
    dateTime,
    label: `${dateTime.slice(0, 10)} · ${dateTime.slice(11, 16)} UTC`,
  };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function payloadTextField(type: LifeEventType): "text" | "summary" | "reply_text" {
  if (type === "agent.thought") return "text";
  if (type === "moa.report") return "summary";
  return "reply_text";
}

function isSupportedLifeEventType(type: string): type is LifeEventType {
  return SUPPORTED_LIFE_EVENT_TYPES.has(type as LifeEventType);
}

function readOwnNonBlankString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  if (!Object.hasOwn(record, key)) return null;
  const value = record[key];
  return isNonBlankString(value) ? value.trim() : null;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
