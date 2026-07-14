import Link from "next/link";

import {
  getControlModule,
  getControlModulesByDomain,
  type ControlModule,
} from "../model/control-modules";
import styles from "./ControlShell.module.css";

function DomainLabel({ domain }: { readonly domain: ControlModule["domain"] }) {
  return domain === "system" ? "系统域" : "Soul 域";
}

export function ModuleDossier({ module }: { readonly module: ControlModule }) {
  const available = module.status === "available";
  const domainModules = getControlModulesByDomain(module.domain);
  const domainIndex = domainModules.findIndex(({ id }) => id === module.id);
  const previous = domainIndex > 0 ? domainModules[domainIndex - 1] : undefined;
  const next = domainIndex >= 0 && domainIndex < domainModules.length - 1
    ? domainModules[domainIndex + 1]
    : undefined;
  const relatedModules = module.relatedModuleIds
    .map((id) => getControlModule(id))
    .filter((related): related is ControlModule => related !== undefined);

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

      {!available && (
        <div className={styles.readinessFlow}>
          <div className={styles.readinessChapter} aria-hidden>
            <span>{module.index}</span>
            <small>READINESS</small>
          </div>

          <section
            className={styles.readinessQuestions}
            aria-labelledby={`${module.id}-questions-title`}
          >
            <p className={styles.eyebrow}>QUESTIONS · 验收问题</p>
            <h2 id={`${module.id}-questions-title`}>此档案必须回答</h2>
            <ol className={styles.questionList}>
              {module.questions.map((question, index) => (
                <li key={question}>
                  <span aria-hidden>{String(index + 1).padStart(2, "0")}</span>
                  <p>{question}</p>
                </li>
              ))}
            </ol>
          </section>

          <section
            className={styles.authorityLedger}
            aria-labelledby={`${module.id}-authority-title`}
          >
            <p className={styles.eyebrow}>MISSING AUTHORITY · 权威缺口</p>
            <h2 id={`${module.id}-authority-title`}>尚未接入的权威证据</h2>
            <p className={styles.authorityIntroduction}>
              此规划档案尚无网页合同。以下是解锁前必须接入的权威证据。
            </p>
            <ul className={styles.authorityList}>
              {module.authorityRequirements.map((requirement) => (
                <li key={requirement}>
                  <span aria-hidden />
                  <p>{requirement}</p>
                </li>
              ))}
            </ul>
          </section>

          <nav className={styles.relatedDossiers} aria-label="相关档案">
            <p className={styles.eyebrow}>RELATED · 交叉索引</p>
            <ul>
              {relatedModules.map((related) => (
                <li key={related.id}>
                  <Link href={related.href}>
                    <span>{related.index}</span>
                    <strong>{related.title}</strong>
                    <small>{related.subtitle}</small>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav className={styles.domainDossiers} aria-label="同域档案">
            {previous && (
              <Link
                className={styles.domainDossierLink}
                href={previous.href}
                rel="prev"
                aria-label={`上一档 · ${previous.title}`}
              >
                <span>上一档</span>
                <strong>{previous.index} · {previous.title}</strong>
              </Link>
            )}
            {next && (
              <Link
                className={styles.domainDossierLink}
                href={next.href}
                rel="next"
                aria-label={`下一档 · ${next.title}`}
              >
                <span>下一档</span>
                <strong>{next.index} · {next.title}</strong>
              </Link>
            )}
          </nav>
        </div>
      )}
    </article>
  );
}
