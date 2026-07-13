import type { ControlModule } from "../model/control-modules";
import styles from "./ControlShell.module.css";

function DomainLabel({ domain }: { readonly domain: ControlModule["domain"] }) {
  return domain === "system" ? "系统域" : "Soul 域";
}

export function ModuleDossier({ module }: { readonly module: ControlModule }) {
  const available = module.status === "available";

  return (
    <article className={styles.dossier} aria-labelledby="module-title">
      <header className={styles.dossierHeader}>
        <p className={styles.eyebrow}>
          {module.index} · <DomainLabel domain={module.domain} /> ·
          {available ? " AVAILABLE" : " PLANNED"}
        </p>
        <div className={styles.dossierTitleLine}>
          <div>
            <h1 id="module-title">{module.title}</h1>
            <p className={styles.dossierSubtitle}>{module.subtitle}</p>
          </div>
          <span className={styles.dossierStatus} data-status={module.status}>
            {available ? "可用" : "规划中"}
          </span>
        </div>
        <p className={styles.dossierSummary}>{module.summary}</p>
      </header>

      <section className={styles.contractBoundary} aria-labelledby="contract-boundary-title">
        <div className={styles.contractSeal} aria-hidden>
          <span>{module.index}</span>
        </div>
        <div className={styles.contractCopy}>
          <p className={styles.eyebrow}>CONTRACT BOUNDARY · 合同边界</p>
          <h2 id="contract-boundary-title">
            {available ? "合同已提供 · 工作面正在迁移" : "当前 Core 未提供此模块的网页合同"}
          </h2>
          <p>{module.prerequisite}</p>
          {available ? (
            <ul className={styles.contractList} aria-label="现有 Core 合同">
              {module.contracts.map((contract) => (
                <li key={contract}>{contract}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.plannedState}>状态：规划中 · 无可执行操作</p>
          )}
        </div>
      </section>
    </article>
  );
}
