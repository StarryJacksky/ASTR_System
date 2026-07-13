export type MobileDomainId = "presence" | "tasks" | "workbench" | "knowledge" | "safety";
export type MobileDomainHref = `/mobile/${MobileDomainId}`;
export type MobileDomainStatus =
  | "local-available"
  | "local-only"
  | "unavailable"
  | "local-read-only";

export interface MobileDomainDefinition {
  readonly id: MobileDomainId;
  readonly href: MobileDomainHref;
  readonly label: string;
  readonly index: string;
  readonly status: MobileDomainStatus;
}

const domainDefinitions = [
  {
    id: "presence",
    href: "/mobile/presence",
    label: "露怀秋",
    index: "01",
    status: "local-available",
  },
  {
    id: "tasks",
    href: "/mobile/tasks",
    label: "任务",
    index: "02",
    status: "local-only",
  },
  {
    id: "workbench",
    href: "/mobile/workbench",
    label: "AI 工作台",
    index: "03",
    status: "unavailable",
  },
  {
    id: "knowledge",
    href: "/mobile/knowledge",
    label: "知识",
    index: "04",
    status: "unavailable",
  },
  {
    id: "safety",
    href: "/mobile/safety",
    label: "设备与安全",
    index: "05",
    status: "local-read-only",
  },
] as const satisfies readonly MobileDomainDefinition[];

export const MOBILE_DOMAINS: readonly MobileDomainDefinition[] = Object.freeze(
  domainDefinitions.map((definition) => Object.freeze(definition)),
);

export function getMobileDomainByPath(pathname: string): MobileDomainDefinition {
  return MOBILE_DOMAINS.find(({ href }) => href === pathname) ?? MOBILE_DOMAINS[0];
}
