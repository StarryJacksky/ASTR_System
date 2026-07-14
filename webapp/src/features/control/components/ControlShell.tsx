"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/astr/ThemeToggle";
import { VisualMotionRouteSlot } from "@/components/system/VisualMotionToggle";

import { getControlModule } from "../model/control-modules";
import { ControlAtlas } from "./ControlAtlas";
import styles from "./ControlShell.module.css";

function currentModuleFromPath(pathname: string) {
  const [moduleId] = pathname.replace(/^\/admin\/?/, "").split("/");
  return moduleId ? getControlModule(moduleId) : undefined;
}

export function ControlShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const currentModule = currentModuleFromPath(pathname);
  const atlasDisclosureRef = useRef<HTMLDetailsElement>(null);
  const atlasSummaryRef = useRef<HTMLElement>(null);
  const [atlasOpenPath, setAtlasOpenPath] = useState<string | null>(null);
  const atlasOpen = atlasOpenPath === pathname;

  useEffect(() => {
    const disclosure = atlasDisclosureRef.current;
    if (disclosure !== null) disclosure.open = false;
  }, [pathname]);

  const openModuleIndex = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const disclosure = atlasDisclosureRef.current;
    if (disclosure === null) return;
    disclosure.open = true;
  };

  const dismissAtlas = (reason: "escape" | "navigate") => {
    const disclosure = atlasDisclosureRef.current;
    if (disclosure !== null) disclosure.open = false;
    setAtlasOpenPath(null);
    if (reason === "escape") atlasSummaryRef.current?.focus();
  };

  return (
    <div className={styles.shell} data-route-surface="control">
      <div className={styles.controlField} aria-hidden />
      <a className={styles.localSkip} href="#module-index" onClick={openModuleIndex}>
        跳到模块索引
      </a>

      <aside className={styles.spine} aria-label="Control 主权书脊">
        <Link className={styles.wordmark} href="/admin" aria-label="Control 首页">
          <span aria-hidden>星</span>
          <strong>ASTR</strong>
        </Link>
        <span className={styles.spineTitle} aria-hidden>
          CONTROL
        </span>
        <nav className={styles.spaceLinks} aria-label="跨空间">
          <Link
            className={styles.spaceLink}
            href="/"
            aria-label="返回 Presence"
            prefetch={false}
          >
            <span aria-hidden>←</span>
            <span>Presence</span>
          </Link>
          <Link className={styles.spaceLink} href="/studio" prefetch={false}>
            Studio
          </Link>
          <Link
            className={styles.spaceLink}
            href="/mobile/presence"
            prefetch={false}
          >
            Mobile
          </Link>
        </nav>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.controlHeader}>
          <div className={styles.currentDossier}>
            {currentModule && (
              <nav aria-label="模块面包屑" className={styles.breadcrumb}>
                <ol>
                  <li><Link href="/admin">Control</Link></li>
                  <li>{currentModule.domain === "system" ? "系统域" : "Soul 域"}</li>
                  <li aria-current="page">{currentModule.title}</li>
                </ol>
              </nav>
            )}
            <p className={styles.eyebrow}>CONTROL / 主权控制面</p>
            <div className={styles.currentLine}>
              <p className={styles.currentTitle} aria-label="当前档案">
                {currentModule?.title ?? "主权档案索引"}
              </p>
              {currentModule && (
                <span className={styles.currentStatus} data-status={currentModule.status}>
                  状态：{currentModule.status === "available" ? "可用" : "规划中"}
                </span>
              )}
            </div>
          </div>

          <div className={styles.headerTools}>
            <span className={styles.surfaceVersion}>SURFACE W2</span>
            <details
              className={styles.atlasDisclosure}
              ref={atlasDisclosureRef}
              onToggle={(event) => {
                setAtlasOpenPath(event.currentTarget.open ? pathname : null);
              }}
            >
              <summary
                id="module-index"
                ref={atlasSummaryRef}
                onKeyDown={(event) => {
                  if (
                    event.key !== "Escape" ||
                    !atlasOpen ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229 ||
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey
                  ) return;
                  event.preventDefault();
                  dismissAtlas("escape");
                }}
              >
                <span aria-hidden className={styles.indexGlyph}>
                  18
                </span>
                <span>模块索引</span>
              </summary>
              <div className={styles.atlasPanel}>
                <ControlAtlas
                  key={pathname}
                  variant="disclosure"
                  activeId={currentModule?.id}
                  open={atlasOpen}
                  onDismiss={dismissAtlas}
                />
              </div>
            </details>
            <ThemeToggle />
            <VisualMotionRouteSlot />
          </div>
        </header>

        <main
          className={styles.main}
          id="main-content"
          tabIndex={0}
          inert={atlasOpen ? true : undefined}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
