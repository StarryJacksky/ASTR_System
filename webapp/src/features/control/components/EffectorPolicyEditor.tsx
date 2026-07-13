"use client";

import type { FormEvent } from "react";

import type { EffectorActions } from "../controller/create-effector-controller";
import type { EffectorPolicy, PolicyPatch } from "../data/effector-client";
import styles from "./EffectorWorkspace.module.css";
import { PolicyChipEditor } from "./PolicyChipEditor";
import { SegmentedRadio } from "./SegmentedRadio";

const APPROVAL_OPTIONS = [
  { value: "ask", label: "请求", description: "每次请求确认" },
  { value: "audited", label: "自审核", description: "按审计策略执行" },
  { value: "auto", label: "全自动", description: "在策略边界内自动执行" },
] as const;

const SCOPE_OPTIONS = [
  { value: "cwd", label: "当前目录" },
  { value: "folders", label: "白名单目录" },
  { value: "full", label: "全电脑" },
] as const;

export interface EffectorPolicyEditorProps {
  readonly policy: EffectorPolicy;
  readonly savingPolicy: boolean;
  readonly onPatch: EffectorActions["patchPolicy"];
}

export function EffectorPolicyEditor({
  policy,
  savingPolicy,
  onPatch,
}: EffectorPolicyEditorProps) {
  const patch = (value: PolicyPatch): void => {
    void onPatch(value);
  };
  const dangerousCategories = mergeFloor(
    policy.dangerous_categories,
    policy.core_dangerous_categories,
  );
  const dangerousKeywords = mergeFloor(
    policy.dangerous_keywords,
    policy.core_dangerous_keywords,
  );

  return (
    <form
      aria-label="执行策略编辑"
      className={styles.controlForm}
      id="control-form"
      onSubmit={(event: FormEvent) => event.preventDefault()}
    >
      <section className={styles.archiveSection} aria-labelledby="policy-authority-title">
        <header className={styles.sectionHeader}>
          <p className={styles.sequence}>POLICY / 01</p>
          <div>
            <h2 className={styles.sectionTitle} id="policy-authority-title">审批与执行范围</h2>
            <p className={styles.sectionNote}>每次只提交一个可写字段；返回的有效策略才是新事实。</p>
          </div>
        </header>

        <div className={styles.policyGrid}>
          <SegmentedRadio
            disabled={savingPolicy}
            label="审批模式"
            options={APPROVAL_OPTIONS}
            value={policy.approval_mode}
            onChange={(approval_mode) => patch({ approval_mode })}
          />
          <SegmentedRadio
            disabled={savingPolicy}
            label="无头执行范围"
            options={SCOPE_OPTIONS}
            value={policy.headless_scope}
            onChange={(headless_scope) => patch({ headless_scope })}
          />

          {policy.headless_scope === "cwd" && (
            <label className={styles.field}>
              <span className={styles.label}>当前工作目录</span>
              <input
                key={policy.headless_cwd}
                aria-label="当前工作目录"
                className={styles.textInput}
                defaultValue={policy.headless_cwd}
                disabled={savingPolicy}
                type="text"
                onBlur={(event) => {
                  const headless_cwd = event.currentTarget.value.trim();
                  if (headless_cwd !== policy.headless_cwd) patch({ headless_cwd });
                }}
              />
            </label>
          )}
          {policy.headless_scope === "folders" && (
            <PolicyChipEditor
              disabled={savingPolicy}
              items={policy.headless_folders}
              label="允许的文件夹"
              locked={[]}
              placeholder="输入完整文件夹路径"
              onChange={(headless_folders) => patch({ headless_folders })}
            />
          )}

          <label className={styles.field}>
            <span className={styles.label}>单任务最大步骤</span>
            <input
              aria-label="单任务最大步骤"
              className={styles.numberInput}
              disabled={savingPolicy}
              max={100}
              min={1}
              type="number"
              value={policy.max_steps_per_task}
              onChange={(event) => {
                const max_steps_per_task = Number(event.currentTarget.value);
                if (
                  Number.isInteger(max_steps_per_task) &&
                  max_steps_per_task >= 1 &&
                  max_steps_per_task <= 100 &&
                  max_steps_per_task !== policy.max_steps_per_task
                ) {
                  patch({ max_steps_per_task });
                }
              }}
            />
          </label>

          <PolicyChipEditor
            disabled={savingPolicy}
            items={policy.app_whitelist}
            label="允许的应用"
            locked={[]}
            placeholder="输入应用名称"
            onChange={(app_whitelist) => patch({ app_whitelist })}
          />
          <PolicyChipEditor
            disabled={savingPolicy}
            items={policy.login_sites_whitelist}
            label="允许登录的网站"
            locked={[]}
            placeholder="输入网站域名"
            onChange={(login_sites_whitelist) => patch({ login_sites_whitelist })}
          />
        </div>
      </section>

      <section className={styles.archiveSection} aria-labelledby="policy-floor-title">
        <header className={styles.sectionHeader}>
          <p className={styles.sequence}>POLICY / 02</p>
          <div>
            <h2 className={styles.sectionTitle} id="policy-floor-title">安全底线</h2>
            <p className={styles.sectionNote}>Core 底线始终可见且不可从网页移除。</p>
          </div>
        </header>
        <div className={styles.policyGrid}>
          <PolicyChipEditor
            disabled={savingPolicy}
            items={dangerousCategories}
            label="危险类别"
            locked={policy.core_dangerous_categories}
            placeholder="输入危险类别"
            onChange={(dangerous_categories) => patch({ dangerous_categories })}
          />
          <PolicyChipEditor
            disabled={savingPolicy}
            items={dangerousKeywords}
            label="危险关键词"
            locked={policy.core_dangerous_keywords}
            placeholder="输入危险关键词"
            onChange={(dangerous_keywords) => patch({ dangerous_keywords })}
          />
        </div>
      </section>

      <section className={styles.sourceStrip} aria-labelledby="policy-source-title">
        <header>
          <p className={styles.sequence}>POLICY / SOURCE</p>
          <h2 className={styles.sectionTitle} id="policy-source-title">只读来源证据</h2>
        </header>
        <dl className={styles.sourceList}>
          <div className={styles.sourceEntry}>
            <dt className={styles.sourceLabel}>Current cwd</dt>
            <dd className={styles.sourceValue}>{policy.headless_cwd}</dd>
          </div>
          <div className={styles.sourceEntry}>
            <dt className={styles.sourceLabel}>Sandbox</dt>
            <dd className={styles.sourceValue}>{policy.sandbox_dir}</dd>
          </div>
          <div className={styles.sourceEntry}>
            <dt className={styles.sourceLabel}>Overlay</dt>
            <dd className={styles.sourceValue}>{policy.overlay_path}</dd>
          </div>
          <div className={styles.sourceEntry}>
            <dt className={styles.sourceLabel}>Locked fields</dt>
            <dd className={styles.sourceValue}>
              {policy.locked.length > 0
                ? policy.locked.map((field) => <span key={field}>{field}</span>)
                : "无额外锁定字段"}
            </dd>
          </div>
        </dl>
      </section>

      {savingPolicy && <p className={styles.savingLine}>策略保存中 · 等待 Core 返回有效策略</p>}
    </form>
  );
}

function mergeFloor(items: readonly string[], floor: readonly string[]): readonly string[] {
  return [...floor, ...items.filter((item) => !floor.includes(item))];
}
