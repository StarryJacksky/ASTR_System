"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import Link from "next/link";

import {
  CONTROL_MODULES,
  getControlModulesByDomain,
  type ControlDomain,
} from "../model/control-modules";
import styles from "./ControlShell.module.css";

const DOMAIN_COPY: Readonly<
  Record<ControlDomain, { readonly label: string; readonly code: string; readonly summary: string }>
> = {
  system: {
    label: "系统域",
    code: "SYSTEM ARCHIVE",
    summary: "平台、运行、来源与系统边界",
  },
  soul: {
    label: "Soul 域",
    code: "SOUL ARCHIVE",
    summary: "灵魂、记忆、训练与执行边界",
  },
};

export type ControlAtlasDismissReason = "escape" | "navigate";

interface ControlAtlasProps {
  readonly variant: "page" | "disclosure";
  readonly activeId?: string;
  readonly open?: boolean;
  readonly onDismiss?: (reason: ControlAtlasDismissReason) => void;
}

function normaliseSearch(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function ignoresAtlasKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey;
}

export function ControlAtlas({
  variant,
  activeId,
  open = false,
  onDismiss,
}: ControlAtlasProps) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());
  const wasOpen = useRef(open);
  const normalisedQuery = normaliseSearch(query);
  const visibleModules = useMemo(() => CONTROL_MODULES.filter((module) => {
    if (normalisedQuery.length === 0) return true;
    return normaliseSearch(`${module.index} ${module.title} ${module.subtitle}`)
      .includes(normalisedQuery);
  }), [normalisedQuery]);
  const visibleIds = useMemo<ReadonlySet<string>>(
    () => new Set<string>(visibleModules.map(({ id }) => id)),
    [visibleModules],
  );
  const AtlasHeading = variant === "page" ? "h1" : "h2";
  const DomainHeading = variant === "page" ? "h2" : "h3";

  useEffect(() => {
    if (variant === "disclosure" && open && !wasOpen.current) {
      searchRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open, variant]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (ignoresAtlasKey(event)) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      if (variant === "disclosure") onDismiss?.("escape");
      else searchRef.current?.focus();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const links = visibleModules
      .map(({ id }) => linkRefs.current.get(id))
      .filter((link): link is HTMLAnchorElement => link !== undefined);
    if (links.length === 0) {
      searchRef.current?.focus();
      return;
    }

    const activeIndex = links.indexOf(document.activeElement as HTMLAnchorElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = activeIndex < 0
      ? direction > 0 ? 0 : links.length - 1
      : (activeIndex + direction + links.length) % links.length;
    links[nextIndex].focus();
  };

  const handleNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (variant !== "disclosure") return;
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) return;
    setQuery("");
    onDismiss?.("navigate");
  };

  return (
    <div
      className={styles.atlas}
      data-atlas-variant={variant}
      onKeyDown={handleKeyDown}
    >
      <header className={styles.atlasHeader}>
        <div>
          <p className={styles.eyebrow}>ASTR CONTROL · 18 DOSSIERS</p>
          <AtlasHeading className={styles.atlasTitle}>主权档案索引</AtlasHeading>
        </div>
        <div className={styles.atlasSearchBlock}>
          <p className={styles.atlasIntroduction}>
            这里展示目标信息架构，不展示虚构能力。每一页先说明来源，再决定能否操作。
          </p>
          <label className={styles.atlasSearch} htmlFor={searchId}>
            <span>检索 18 个模块</span>
            <input
              id={searchId}
              ref={searchRef}
              type="search"
              value={query}
              autoComplete="off"
              spellCheck={false}
              placeholder="编号 / 名称 / 别称"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <small aria-hidden>↑↓ 遍历 · Enter 前往 · Esc 复位</small>
          </label>
        </div>
      </header>

      {visibleModules.length === 0 ? (
        <p className={styles.atlasNoResult} role="status">
          未找到匹配档案 · 18 条真实路由保持不变
        </p>
      ) : (
        <div className={styles.atlasDomains}>
          {(["system", "soul"] as const).map((domain) => {
            const copy = DOMAIN_COPY[domain];
            const modules = getControlModulesByDomain(domain)
              .filter(({ id }) => visibleIds.has(id));
            if (modules.length === 0) return null;
            return (
              <section key={domain} className={styles.atlasDomain} aria-label={copy.label}>
                <header className={styles.domainHeader}>
                  <div>
                    <p className={styles.domainCode}>{copy.code}</p>
                    <DomainHeading>{copy.label}</DomainHeading>
                  </div>
                  <p>{copy.summary}</p>
                </header>
                <nav aria-label={`${copy.label}模块`}>
                  <ol className={styles.moduleList}>
                    {modules.map((module) => {
                      const active = module.id === activeId;
                      return (
                        <li key={module.id}>
                          <Link
                            ref={(link) => {
                              if (link === null) linkRefs.current.delete(module.id);
                              else linkRefs.current.set(module.id, link);
                            }}
                            className={styles.moduleLink}
                            data-status={module.status}
                            data-domain={module.domain}
                            aria-current={active ? "page" : undefined}
                            href={module.href}
                            onClick={handleNavigate}
                          >
                            <span className={styles.moduleIndex}>{module.index}</span>
                            <span className={styles.moduleName}>
                              <strong>{module.title}</strong>
                              <small>{module.subtitle}</small>
                            </span>
                            <span className={styles.moduleStatus}>
                              {module.status === "available" ? "可用" : "规划中"}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
