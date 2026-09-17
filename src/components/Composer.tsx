import { track } from "@/lib/analytics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Clock, Paperclip, Square, X } from "lucide-react";
import { useStore, visibleMessages, type Bot, type Group } from "@/state/store";
import { cn } from "@/lib/cn";
import { useComposerDraft } from "@/lib/drafts";
import { MausAvatar } from "./Avatar";
import { ComposerAttachments } from "./ComposerAttachments";
import {
  attachmentsFromDroppedFiles,
  composeMessage,
  isLongPaste,
  pasteAttachment,
  type Attachment,
} from "@/lib/composer-attachments";
import { normalizeState } from "@/lib/mascot";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "./PendingApproval";

/** The active @mention query at the caret: the text between an `@` that
 * starts a word and the caret. null = no mention being typed. */
function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // user@host, not a tag
  const query = upto.slice(at + 1);
  if (query.length > 24 || query.includes("@") || query.includes("\n")) return null;
  return { start: at, query };
}

export function Composer({
  bot,
  group,
  members,
  onEditLast,
}: {
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  onEditLast?: () => void;
}) {
  const { state, dispatch } = useStore();
  // Unified target: a 1:1 bot thread or a room. In a room the @ picker
  // offers the members (Buzz rule: only mentioned bots reply).
  const busy = group ? Boolean(group.busyBotId) : Boolean(bot?.busy);
  // a pending approval blocks the prompt until it is answered
  const threadId = group?.threadId ?? bot?.threadId ?? "";
  // the VISIBLE branch only — an approval left on a branch you edited away
  // from must not keep blocking the composer
  const approvals = pendingApprovals(group ? group.messages : bot ? visibleMessages(bot) : []);
  const approval = approvals[0];
  const approvalBot = group
    ? members?.find((b) => b.id === approval?.message.from?.botId) ??
      members?.find((b) => b.id === group.busyBotId)
    : bot;
  const busyName = group
    ? (members?.find((b) => b.id === group.busyBotId)?.name ?? "A bot")
    : (bot?.name ?? "The bot");
  // Per-thread draft: switching bots unmounts this component, so both the
  // text and its attachment chips have to outlive it (see lib/drafts).
  const [text, setText, attachments, setAttachments] = useComposerDraft(
    group ? `group:${group.id}` : `bot:${bot?.id ?? ""}`,
  );
  const addAttachments = useCallback(
    (next: Attachment[]) => setAttachments((prev) => [...prev, ...next]),
    [setAttachments],
  );
  const removeAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [setAttachments],
  );
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── @mention picker (tag another bot; the agent reaches it via ask_bot) ──
  const mention = mentionQueryAt(text, caret);
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const pool = group ? (members ?? []) : state.bots.filter((b) => b.id !== bot?.id && !b.hidden);
    const q = mention.query.trim().toLowerCase();
    // "@Scout " — the full name plus a space — is a COMPLETED tag, not a
    // search: keep the picker closed so Enter sends instead of re-picking
    if (mention.query.endsWith(" ") && pool.some((b) => b.name.toLowerCase() === q)) return [];
    return pool.filter((b) => !q || b.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, dismissedAt, state.bots, bot?.id, group, members]);
  const pickerOpen = candidates.length > 0;

  useEffect(() => setHighlight(0), [mention?.start, mention?.query]);

  // grow the textarea with its content (capped by max-h in the className)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const pickMention = (peer: Bot) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    setText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    // picking completes this tag — close the popup so the next Enter sends
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  // One message may be queued while the bot works; it auto-sends the moment
  // the turn settles. Enter during a turn queues instead of silently dying.
  const [queued, setQueued] = useState<string | null>(null);
  // a chip on its own is a message: the send control has to appear for it
  const hasContent = Boolean(text.trim()) || attachments.length > 0;
  const send = () => {
    const t = composeMessage(text, attachments);
    if (!t) return;
    if (busy) {
      setQueued(t);
      setText("");
      setAttachments([]);
      return;
    }
    if (group) {
      dispatch({ type: "sendGroup", groupId: group.id, text: t });
      track("message_sent", { room: true });
    } else if (bot) {
      dispatch({ type: "send", botId: bot.id, text: t });
      track("message_sent", { driver: bot.modelSelection?.instanceId });
    }
    setText("");
    setAttachments([]);
  };
  useEffect(() => {
    if (!busy && queued) {
      if (group) dispatch({ type: "sendGroup", groupId: group.id, text: queued });
      else if (bot) dispatch({ type: "send", botId: bot.id, text: queued });
      track("message_sent", { queued: true });
      setQueued(null);
    }
  }, [busy, queued, bot, group, dispatch]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const pathForFile = (file: File) => window.ogb?.getPathForFile?.(file) ?? "";
    const { attachments: newAttachments } = await attachmentsFromDroppedFiles(files, pathForFile);
    if (newAttachments.length > 0) {
      addAttachments(newAttachments);
    }
    if (e.target) e.target.value = "";
  };

  return (
    <div className="px-[max(0.625rem,env(safe-area-inset-left))] sm:px-5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pr-[max(0.625rem,env(safe-area-inset-right))] shrink-0">
      <div className="relative mx-auto max-w-[900px]">
        {queued && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-[12.5px] text-ink-secondary">
            <Clock size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Queued — sends when {busyName} finishes: “{queued}”
            </span>
            <button
              onClick={() => setQueued(null)}
              aria-label="Discard queued message"
              className="rounded p-0.5 hover:bg-raised hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
        )}
        {pickerOpen && (
          <div
            role="listbox"
            aria-label="Tag a bot"
            className="absolute bottom-full left-2 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-hairline/40 bg-raised shadow-lg"
          >
            {candidates.map((peer, i) => (
              <button
                key={peer.id}
                role="option"
                aria-selected={i === highlight}
                onClick={() => pickMention(peer)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === highlight ? "bg-raised-hover" : "",
                )}
              >
                <MausAvatar color={peer.color} state={normalizeState(peer.mascotExpression) ?? "happy"} size={24} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{peer.name}</span>
                <span className="shrink-0 text-xs text-ink-secondary">Agent</span>
              </button>
            ))}
          </div>
        )}
        {/* An approval takes over the composer: you answer it before you
            can type again, so a waiting bot is impossible to miss. */}
        {approval && (
          <div className="mb-2 overflow-hidden rounded-2xl border border-accent/40 bg-card">
            <PendingApprovalPanel pending={approval} count={approvals.length} index={0} />
            <PendingApprovalActions
              pending={approval}
              threadId={threadId}
              bot={approvalBot}
              onCancelTurn={() => {
                if (group) dispatch({ type: "interruptGroup", groupId: group.id });
                else if (bot) dispatch({ type: "interrupt", botId: bot.id });
              }}
            />
          </div>
        )}
        <ComposerAttachments
          items={attachments}
          onAdd={addAttachments}
          onRemove={removeAttachment}
        />
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          className="hidden"
        />
        <div className="flex items-end gap-1.5 rounded-3xl border border-hairline/40 bg-raised/60 py-1.5 pl-2.5 pr-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="ファイルを添付"
            title="ファイルを添付"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink pb-0.5"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setDismissedAt(null);
            }}
            onPaste={(e) => {
              // a wall of text becomes a chip instead of burying the input
              const pasted = e.clipboardData.getData("text/plain");
              if (!isLongPaste(pasted)) return;
              e.preventDefault();
              // Preserve native paste replacement semantics: if text was
              // selected, the attachment replaces that selection.
              const start = e.currentTarget.selectionStart;
              const end = e.currentTarget.selectionEnd;
              if (start !== end) {
                setText(`${text.slice(0, start)}${text.slice(end)}`);
                setCaret(start);
              }
              setAttachments((prev) => [...prev, pasteAttachment(pasted)]);
            }}
            onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (pickerOpen) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const delta = e.key === "ArrowDown" ? 1 : -1;
                  setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickMention(candidates[highlight]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDismissedAt(mention?.start ?? null);
                  return;
                }
              }
              // an empty composer + ArrowUp = edit your last message (like a chat app)
              if (e.key === "ArrowUp" && !hasContent && onEditLast) {
                e.preventDefault();
                onEditLast();
                return;
              }
              // Shift+Enter inserts a newline; plain Enter sends
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            disabled={Boolean(approval)}
            placeholder={
              approval
                ? "継続するには上の承認リクエストに回答してください"
                : busy
                  ? `${busyName} が処理中 — Enterキーでメッセージをキューに追加`
                  : group
                    ? `${group.name} にメッセージを送信 — @ でボット呼出`
                    : `${bot?.name ?? ""} にメッセージを送信…`
            }
            aria-label={`${group ? group.name : (bot?.name ?? "")} にメッセージを送信`}
            className="max-h-40 w-full resize-none self-center bg-transparent py-1 text-[16px] sm:text-[15px] leading-6 text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          {busy && (
            <button
              onClick={() => {
                if (group) dispatch({ type: "interruptGroup", groupId: group.id });
                else if (bot) dispatch({ type: "interrupt", botId: bot.id });
              }}
              aria-label="このターンを停止"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
              title="停止"
            >
              <Square size={14} className="fill-current" />
            </button>
          )}
          {hasContent && (
            <button
              onClick={send}
              aria-label={busy ? "メッセージをキューに追加" : "送信"}
              title={busy ? "キューに追加 — ボットの完了後に送信されます" : "送信"}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-white",
                busy ? "bg-raised text-ink-secondary hover:bg-raised-hover" : "bg-accent hover:brightness-110",
              )}
            >
              {busy ? <Clock size={15} /> : <ArrowUp size={17} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
