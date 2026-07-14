import { STUDIO_PROJECTIONS } from "../model/studio-projections";
import styles from "./StudioSurface.module.css";

export function StudioUnavailableWorkplane() {
  return (
    <main
      className={styles.workplane}
      data-studio-state="unavailable"
      id="main-content"
      tabIndex={-1}
    >
      <div className={styles.instrumentFrame} data-studio-instrument-frame="">
        <header className={styles.truthField} data-studio-truth-field="">
          <p className={styles.eyebrow}>STUDIO / CONTRACT HORIZON</p>
          <h1>Studio 投影未启用</h1>
          <p className={styles.reason}>
            缺少已授权 authority、认证 scopes 与只读 endpoints。
          </p>
          <p className={styles.evidenceLimit}>
            没有可验证的 Run、模型路由、成本或产物数据。
          </p>
          <p className={styles.contractStatement}>当前 Core 未提供 /v1/studio/* 读取合同；本页面不会发起 Studio 资源请求。</p>
        </header>

        <section
          aria-labelledby="studio-fact-heading"
          className={styles.factRail}
        >
          <h2 className="sr-only" id="studio-fact-heading">
            Studio 合同事实
          </h2>
          <dl className={styles.factList}>
            <div>
              <dt>Authority</dt>
              <dd>稳定来源未建立</dd>
            </div>
            <div>
              <dt>Identity scope</dt>
              <dd>认证主体与 scopes 未提供</dd>
            </div>
            <div>
              <dt>Read contract</dt>
              <dd>只读合同未安装</dd>
            </div>
            <div>
              <dt>Request policy</dt>
              <dd>零 Studio 资源请求</dd>
            </div>
          </dl>
        </section>

        <div
          aria-hidden="true"
          className={styles.datum}
          data-studio-datum=""
        >
          <span className={styles.datumSegment} />
          <span
            className={styles.contractGap}
            data-studio-contract-gap=""
          />
          <span className={styles.datumSegment} />
        </div>

        <section
          aria-labelledby="studio-projection-heading"
          className={styles.projectionRegister}
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>PROJECTION REGISTER</p>
            <h2 id="studio-projection-heading">Studio 投影分类目录</h2>
            <p>分类目录，非流程或连接状态</p>
          </div>
          <ol className={styles.projectionList}>
            {STUDIO_PROJECTIONS.map((projection) => (
              <li
                data-projection-state={projection.state}
                data-studio-registration-mark=""
                key={projection.id}
              >
                <span>
                  <strong>{projection.label}</strong>
                  <small>{projection.purpose}</small>
                </span>
                <em>投影未启用</em>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="studio-gate-heading"
          className={styles.gateRail}
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>IMPLEMENTATION GATE</p>
            <h2 id="studio-gate-heading">Studio 实施门</h2>
          </div>
          <ol className={styles.gateList}>
            <li>稳定 authority 与 ownership</li>
            <li>认证 principal 与 scopes</li>
            <li>通过安全评审的薄只读 endpoints</li>
          </ol>
          <p className={styles.noActionNotice}>
            当前表面不提供 Run、Approve、Tool 或 Download 操作。
          </p>
        </section>
      </div>
    </main>
  );
}
