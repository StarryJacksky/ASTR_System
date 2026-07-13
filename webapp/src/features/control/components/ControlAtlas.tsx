import Link from "next/link";

import {
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

export function ControlAtlas({ activeId }: { readonly activeId?: string }) {
  return (
    <div className={styles.atlas}>
      <header className={styles.atlasHeader}>
        <div>
          <p className={styles.eyebrow}>ASTR CONTROL · 18 DOSSIERS</p>
          <h1 className={styles.atlasTitle}>主权档案索引</h1>
        </div>
        <p className={styles.atlasIntroduction}>
          这里展示目标信息架构，不展示虚构能力。每一页先说明来源，再决定能否操作。
        </p>
      </header>

      <div className={styles.atlasDomains}>
        {(["system", "soul"] as const).map((domain) => {
          const copy = DOMAIN_COPY[domain];
          const modules = getControlModulesByDomain(domain);
          return (
            <section key={domain} className={styles.atlasDomain} aria-label={copy.label}>
              <header className={styles.domainHeader}>
                <div>
                  <p className={styles.domainCode}>{copy.code}</p>
                  <h2>{copy.label}</h2>
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
                          className={styles.moduleLink}
                          data-status={module.status}
                          aria-current={active ? "page" : undefined}
                          href={module.href}
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
    </div>
  );
}
