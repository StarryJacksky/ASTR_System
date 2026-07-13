"use client";

import { Copy, RotateCcw, Send } from "lucide-react";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";

import type {
  PresenceControllerActions,
  PresenceControllerDiagnostic,
} from "@/features/presence/controller/create-presence-controller";
import type { DraftSnapshot } from "@/features/presence/model/presence-types";
import { canSend, type SemanticState } from "@/lib/semantic-state";
import type { ConversationProjection } from "@/lib/types";
import type { MicRecorderFactory } from "@/lib/wav";

import styles from "./Composer.module.css";
import { VoiceInput } from "./VoiceInput";

export interface ComposerSnapshot {
  readonly draft: DraftSnapshot;
  readonly semantic: SemanticState;
  readonly conversation: Pick<ConversationProjection, "receipt" | "error">;
  readonly diagnostics: readonly PresenceControllerDiagnostic[];
}

export type ComposerActions = Pick<
  PresenceControllerActions,
  "updateDraft" | "send" | "retryFailed" | "transcribe"
>;

export interface ComposerProps {
  readonly snapshot: ComposerSnapshot;
  readonly actions: ComposerActions;
  readonly recorderFactory?: MicRecorderFactory;
  readonly copyText?: (text: string) => Promise<void>;
  readonly maxRecordingMs?: number;
}

export function Composer({
  snapshot,
  actions,
  recorderFactory,
  copyText = writeClipboard,
  maxRecordingMs,
}: ComposerProps) {
  const feedbackId = useId();
  const diagnosticsId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const compositionRef = useRef(false);
  const submissionRef = useRef(false);
  const revisionRef = useRef(snapshot.draft.revision);
  const draftRef = useRef(snapshot.draft);
  const semanticRef = useRef(snapshot.semantic);
  const focusRevisionRef = useRef<number | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localFailure, setLocalFailure] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

  useLayoutEffect(() => {
    draftRef.current = snapshot.draft;
    semanticRef.current = snapshot.semantic;
    revisionRef.current = Math.max(revisionRef.current, snapshot.draft.revision);
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = clampSelection(snapshot.draft.selectionStart, snapshot.draft.text.length);
    const end = clampSelection(snapshot.draft.selectionEnd, snapshot.draft.text.length, start);
    if (textarea.selectionStart !== start || textarea.selectionEnd !== end) {
      textarea.setSelectionRange(start, end);
    }
    if (focusRevisionRef.current === snapshot.draft.revision) {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      focusRevisionRef.current = null;
    }
  }, [snapshot.draft, snapshot.semantic]);

  const nextRevision = useCallback(() => {
    revisionRef.current = Math.max(revisionRef.current, draftRef.current.revision) + 1;
    return revisionRef.current;
  }, []);

  const updateText = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const text = event.currentTarget.value;
      const selectionStart = event.currentTarget.selectionStart ?? text.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      actions.updateDraft({
        revision: nextRevision(),
        text,
        selectionStart,
        selectionEnd,
      });
    },
    [actions, nextRevision],
  );

  const updateSelection = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      const textarea = event.currentTarget;
      const current = draftRef.current;
      const selectionStart = textarea.selectionStart ?? current.text.length;
      const selectionEnd = textarea.selectionEnd ?? selectionStart;
      if (
        selectionStart === current.selectionStart &&
        selectionEnd === current.selectionEnd
      ) {
        return;
      }
      actions.updateDraft({ ...current, selectionStart, selectionEnd });
    },
    [actions],
  );

  const submit = useCallback(async () => {
    if (submissionRef.current) return;
    const draft = draftRef.current;
    const semantic = semanticRef.current;
    if (
      isConversationPending(semantic) ||
      !canSend(semantic, {
        inputValid: draft.text.trim().length > 0,
        isComposing: compositionRef.current,
      })
    ) {
      return;
    }

    submissionRef.current = true;
    setSubmitting(true);
    setCopyFeedback(null);
    try {
      const acknowledged = await actions.send(draft);
      if (acknowledged) {
        setLocalFailure(null);
        return;
      }
      setLocalFailure("发送未被 Core 接收");
      if (draftRef.current.revision === draft.revision) restoreFocus(draft);
    } catch {
      setLocalFailure("发送未被 Core 接收");
      if (draftRef.current.revision === draft.revision) restoreFocus(draft);
    } finally {
      submissionRef.current = false;
      setSubmitting(false);
    }
  }, [actions]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (
        compositionRef.current ||
        (event as unknown as { readonly isComposing?: boolean }).isComposing === true ||
        event.nativeEvent.isComposing ||
        event.keyCode === 229 ||
        event.nativeEvent.keyCode === 229
      ) {
        return;
      }
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  const beginComposition = useCallback(() => {
    compositionRef.current = true;
    setIsComposing(true);
  }, []);

  const endComposition = useCallback(() => {
    compositionRef.current = false;
    setIsComposing(false);
  }, []);

  const retry = useCallback(async () => {
    const semantic = semanticRef.current;
    if (
      submissionRef.current ||
      compositionRef.current ||
      semantic.core !== "reachable" ||
      isConversationPending(semantic)
    ) {
      return;
    }
    submissionRef.current = true;
    setSubmitting(true);
    setCopyFeedback(null);
    setLocalFailure(null);
    try {
      const accepted = await actions.retryFailed();
      if (!accepted) setLocalFailure("重试未被 Core 接收");
    } catch {
      setLocalFailure("重试未被 Core 接收");
    } finally {
      submissionRef.current = false;
      setSubmitting(false);
    }
  }, [actions]);

  const visibleError = snapshot.conversation.error ?? localFailure;
  const diagnostics = useMemo(
    () => {
      const related = recentRecoverableDiagnostics(snapshot.diagnostics);
      if (related.length > 0) return related;
      return localFailure
        ? ([
            { code: "INGEST_FAILED", message: localFailure, at: 0 },
          ] satisfies readonly RecoverableDiagnostic[])
        : [];
    },
    [localFailure, snapshot.diagnostics],
  );

  const copyDiagnostic = useCallback(async () => {
    if (diagnostics.length === 0) return;
    try {
      await copyText(diagnostics.map(formatDiagnostic).join("\n\n"));
      setCopyFeedback("诊断已复制");
    } catch {
      setCopyFeedback("诊断复制失败");
    }
  }, [copyText, diagnostics]);

  const acceptTranscript = useCallback(
    (transcript: string) => {
      const current = draftRef.current;
      const start = clampSelection(current.selectionStart, current.text.length);
      const end = clampSelection(current.selectionEnd, current.text.length, start);
      const text = `${current.text.slice(0, start)}${transcript}${current.text.slice(end)}`;
      const cursor = start + transcript.length;
      const next: DraftSnapshot = {
        revision: nextRevision(),
        text,
        selectionStart: cursor,
        selectionEnd: cursor,
      };
      focusRevisionRef.current = next.revision;
      actions.updateDraft(next);
    },
    [actions, nextRevision],
  );

  const pending = isConversationPending(snapshot.semantic);
  const sendEnabled =
    !submitting &&
    !pending &&
    canSend(snapshot.semantic, {
      inputValid: snapshot.draft.text.trim().length > 0,
      isComposing,
    });
  const retryEnabled =
    !submitting &&
    !pending &&
    !isComposing &&
    snapshot.semantic.core === "reachable";
  const feedback = composerFeedback(snapshot, visibleError, copyFeedback);

  return (
    <section className={styles.composer} aria-label="对话输入">
      <label className={styles.label} htmlFor="presence-message-input">
        <span>MESSAGE / 对话</span>
        <span className={styles.revision}>REV {snapshot.draft.revision}</span>
      </label>
      <textarea
        ref={textareaRef}
        id="presence-message-input"
        className={styles.textarea}
        aria-label="消息输入"
        aria-describedby={feedbackId}
        rows={3}
        value={snapshot.draft.text}
        placeholder={
          snapshot.semantic.core === "reachable"
            ? "沿星轨写下此刻……"
            : "Core 尚不可达；草稿仍会保留"
        }
        onChange={updateText}
        onSelect={updateSelection}
        onKeyDown={handleKeyDown}
        onCompositionStart={beginComposition}
        onCompositionEnd={endComposition}
      />

      <div className={styles.actionRail}>
        <VoiceInput
          coreReachable={snapshot.semantic.core === "reachable"}
          transcribe={actions.transcribe}
          onTranscript={acceptTranscript}
          recorderFactory={recorderFactory}
          maxDurationMs={maxRecordingMs}
        />

        <div className={styles.sendActions}>
          {visibleError && diagnostics.length > 0 && (
            <>
              <button
                type="button"
                className={styles.secondaryControl}
                aria-label="重试发送"
                aria-describedby={feedbackId}
                disabled={!retryEnabled}
                onClick={() => void retry()}
              >
                <RotateCcw aria-hidden size={17} />
              </button>
              <button
                type="button"
                className={styles.secondaryControl}
                aria-label="复制诊断"
                aria-describedby={feedbackId}
                onClick={() => void copyDiagnostic()}
              >
                <Copy aria-hidden size={17} />
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.sendControl}
            aria-label="发送消息"
            aria-describedby={feedbackId}
            disabled={!sendEnabled}
            onClick={() => void submit()}
          >
            <Send aria-hidden size={18} />
          </button>
        </div>
      </div>

      <p id={feedbackId} className={visibleError ? styles.errorText : styles.feedback}>
        {feedback}
      </p>

      {visibleError && diagnostics.length > 0 && (
        <div className={styles.diagnosticPanel}>
          <button
            type="button"
            className={styles.diagnosticToggle}
            aria-expanded={diagnosticsExpanded}
            aria-controls={diagnosticsId}
            onClick={() => setDiagnosticsExpanded((expanded) => !expanded)}
          >
            诊断详情 · {diagnostics.length}
          </button>
          <div id={diagnosticsId} hidden={!diagnosticsExpanded}>
            <ul className={styles.diagnosticList} aria-label="最近相关诊断">
              {diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}:${diagnostic.at}:${index}`}
                  className={styles.diagnosticItem}
                >
                  <code className={styles.diagnosticCode}>{diagnostic.code}</code>
                  <span className={styles.diagnosticMessage}>{diagnostic.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );

  function restoreFocus(draft: DraftSnapshot): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(draft.selectionStart, draft.selectionEnd);
  }
}

function isConversationPending(semantic: SemanticState): boolean {
  return semantic.conversation === "sending" || semantic.conversation === "streaming";
}

function recentRecoverableDiagnostics(
  diagnostics: readonly PresenceControllerDiagnostic[],
): readonly RecoverableDiagnostic[] {
  let latestFailureIndex = -1;
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    if (isFailureDiagnostic(diagnostics[index])) {
      latestFailureIndex = index;
      break;
    }
  }
  if (latestFailureIndex < 0) return [];

  let previousFailureIndex = -1;
  for (let index = latestFailureIndex - 1; index >= 0; index -= 1) {
    if (isFailureDiagnostic(diagnostics[index])) {
      previousFailureIndex = index;
      break;
    }
  }

  return diagnostics
    .slice(previousFailureIndex + 1, latestFailureIndex + 1)
    .filter(isRecoverableDiagnostic)
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      at: diagnostic.at,
      ...(typeof diagnostic.eventId === "string"
        ? { eventId: diagnostic.eventId }
        : {}),
      ...(typeof diagnostic.traceId === "string"
        ? { traceId: diagnostic.traceId }
        : {}),
    }));
}

function isFailureDiagnostic(
  diagnostic: PresenceControllerDiagnostic | undefined,
): diagnostic is PresenceControllerDiagnostic & RecoverableDiagnostic {
  return (
    diagnostic !== undefined &&
    (diagnostic.code === "INGEST_FAILED" || diagnostic.code === "REQUEST_TIMED_OUT") &&
    typeof diagnostic.message === "string"
  );
}

function isRecoverableDiagnostic(
  diagnostic: PresenceControllerDiagnostic,
): diagnostic is PresenceControllerDiagnostic & RecoverableDiagnostic {
  return (
    (diagnostic.code === "INGEST_FAILED" ||
      diagnostic.code === "REQUEST_TIMED_OUT" ||
      diagnostic.code === "UNBOUND_STREAM_DROPPED") &&
    typeof diagnostic.message === "string"
  );
}

interface RecoverableDiagnostic {
  readonly code: "INGEST_FAILED" | "REQUEST_TIMED_OUT" | "UNBOUND_STREAM_DROPPED";
  readonly message: string;
  readonly at: number;
  readonly eventId?: string;
  readonly traceId?: string;
}

function formatDiagnostic(diagnostic: {
  readonly code: string;
  readonly message: string;
  readonly at: number;
  readonly eventId?: string;
  readonly traceId?: string;
}): string {
  return [
    "ASTR Presence diagnostic",
    `code: ${diagnostic.code}`,
    `message: ${diagnostic.message}`,
    `at: ${Number.isFinite(diagnostic.at) ? diagnostic.at : "unknown"}`,
    ...(diagnostic.eventId ? [`eventId: ${diagnostic.eventId}`] : []),
    ...(diagnostic.traceId ? [`traceId: ${diagnostic.traceId}`] : []),
  ].join("\n");
}

function composerFeedback(
  snapshot: ComposerSnapshot,
  visibleError: string | null,
  copyFeedback: string | null,
): string {
  let primary: string;
  if (visibleError) primary = `发送失败：${visibleError}`;
  else if (snapshot.semantic.conversation === "final") {
    primary = "回答完成；权威终稿已到达";
  } else if (snapshot.semantic.core !== "reachable") {
    primary = "Core 不可达；草稿仅保存在当前页面";
  } else if (isConversationPending(snapshot.semantic)) {
    primary = "发送中；等待 Core 回执或终稿";
  } else if (snapshot.conversation.receipt) {
    primary = "Core 已接收；回答尚未完成";
  } else {
    primary = "Enter 发送，Shift+Enter 换行";
  }
  return copyFeedback ? `${primary}；${copyFeedback}` : primary;
}

function clampSelection(value: number, length: number, minimum = 0): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(length, Math.trunc(value)));
}

async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
  await navigator.clipboard.writeText(text);
}
