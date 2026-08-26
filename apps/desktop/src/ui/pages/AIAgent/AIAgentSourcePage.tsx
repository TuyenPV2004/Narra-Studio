import {
  Check,
  Copy,
  Download,
  ListTodo,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import chatbotAvatarUrl from "@/assets/chatbot-icon.svg";
import { FormEvent, KeyboardEvent, UIEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { agentApi, type AgentMessage } from "@/services/electron-api/agent";
import { conversationPackageApi } from "@/services/electron-api/agent-conversations";
import { WorkspacePanel } from "@/pages/AIAgent/components/WorkspacePanel";
import { WorkflowPanel } from "@/pages/AIAgent/components/WorkflowPanel";
import { SkillsPanel } from "@/pages/AIAgent/components/SkillsPanel";
import { DirectorPanel } from "@/pages/AIAgent/components/DirectorPanel";
import { MediaToolsPanel } from "@/pages/AIAgent/components/MediaToolsPanel";
import { useAgentConversationLibrary } from "@/pages/AIAgent/useAgentConversationLibrary";
import type { ProviderId } from "@/types/electron-api";

const welcome: AgentMessage = {
  id: "welcome-msg",
  role: "assistant",
  content:
    "Em có thể hỗ trợ phát triển ý tưởng, prompt và kế hoạch sản xuất. Hãy mô tả mục tiêu của anh.",
  status: "completed",
};

export function AIAgentSourcePage({ providerId }: { providerId: ProviderId }) {
  const [view, setView] = useState<
    "chat" | "director" | "media" | "skills" | "workflow" | "workspace"
  >("chat");
  const conversation = useAgentConversationLibrary(welcome);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [activeModel, setActiveModel] = useState<string>("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [confirmModal, setConfirmModal] = useState<"clear" | "delete" | null>(
    null,
  );
  const importRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamCancelRef = useRef<(() => void) | null>(null);
  const chatContainerRef = useRef<HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // Auto-scroll to bottom only when user is already near the bottom
  useEffect(() => {
    if (view === "chat" && isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [conversation.messages, sending, view]);

  const handleScroll = (event: UIEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const distance =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    isNearBottomRef.current = distance < 120;
  };

  // Clean up streaming request on unmount
  useEffect(() => {
    return () => {
      if (streamCancelRef.current) {
        streamCancelRef.current();
        streamCancelRef.current = null;
      }
      agentApi.cancelChat();
    };
  }, []);

  const stopStreaming = () => {
    if (streamCancelRef.current) {
      try {
        streamCancelRef.current();
      } catch {
        // ignore
      }
      streamCancelRef.current = null;
    }
    agentApi.cancelChat();
    conversation.setMessages(
      (current) =>
        current.map((message, index) =>
          index === current.length - 1 &&
          message.role === "assistant" &&
          message.status === "streaming"
            ? { ...message, status: "cancelled" }
            : message,
        ),
      true,
    );
    setSending(false);
  };

  const handleSendMessage = async (textToSend: string) => {
    const content = textToSend.trim();
    if (!content || sending || !conversation.hydrated) return;

    const userMessage: AgentMessage = {
      id: `usr-${Date.now()}`,
      role: "user",
      content,
      status: "completed",
    };
    const assistantPlaceholder: AgentMessage = {
      id: `ast-${Date.now()}`,
      role: "assistant",
      content: "",
      status: "streaming",
    };

    conversation.setMessages((current) => [
      ...current,
      userMessage,
      assistantPlaceholder,
    ]);
    setInput("");
    setSending(true);
    setError(undefined);
    isNearBottomRef.current = true;

    try {
      const activePlan = conversation.activeConversation.plan;
      const runItems = conversation.activeConversation.runItems;
      const res = await agentApi.chatStream(
        content,
        conversation.messages,
        (next) =>
          conversation.setMessages((current) =>
            current.map((message, index) =>
              index === current.length - 1
                ? { ...message, content: next, status: "streaming" }
                : message,
            ),
          ),
        (cancelFn) => {
          streamCancelRef.current = cancelFn;
        },
        Boolean(activePlan),
        {
          brief: conversation.activeConversation.title,
          planTitle: (activePlan as { title?: string })?.title || "",
          runItemsCount: Array.isArray(runItems) ? runItems.length : 0,
          kind: conversation.activeConversation.kind,
        },
        ({ model, source }) => {
          if (model) setActiveModel(model);
        },
      );

      conversation.setMessages(
        (current) =>
          current.map((message, index) =>
            index === current.length - 1
              ? {
                  ...message,
                  content: res.reply,
                  status: "completed",
                  model: res.model,
                  provider: res.source,
                }
              : message,
          ),
        true, // persist ngay lập tức khi stream hoàn tất
      );
    } catch (value) {
      const errMsg = value instanceof Error ? value.message : String(value);
      const isCancelled =
        errMsg.toLowerCase().includes("cancel") ||
        errMsg.toLowerCase().includes("abort");

      conversation.setMessages(
        (current) =>
          current
            .map((message, index) => {
              if (index !== current.length - 1 || message.role !== "assistant") {
                return message;
              }
              if (isCancelled) {
                return { ...message, status: "cancelled" };
              }
              if (message.content) {
                return { ...message, status: "failed", error: errMsg };
              }
              return null;
            })
            .filter(Boolean) as AgentMessage[],
        true,
      );
      if (!isCancelled) {
        setError(errMsg);
      }
    } finally {
      streamCancelRef.current = null;
      setSending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await handleSendMessage(input);
  };

  const retryLastMessage = async () => {
    if (sending || !conversation.hydrated) return;
    const history = conversation.messages;
    const lastUserIndex = [...history]
      .reverse()
      .findIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;
    const targetUserIndex = history.length - 1 - lastUserIndex;
    const userMsg = history[targetUserIndex];
    if (!userMsg?.content) return;

    // Prune subsequent assistant messages
    conversation.setMessages(
      history.slice(0, targetUserIndex),
      false,
    );
    await handleSendMessage(userMsg.content);
  };

  const copyMessageContent = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1800);
    } catch {
      // ignore
    }
  };

  const applyIdeaToWorkflow = (content: string) => {
    conversation.updateActiveConversationWorkflow({
      title: content.slice(0, 60).replace(/[\r\n]+/g, " ").trim(),
    });
    setView("workflow");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      if (event.nativeEvent.isComposing || (event as unknown as { isComposing?: boolean }).isComposing) {
        return;
      }
      event.preventDefault();
      if (input.trim() && !sending) {
        void submit(event);
      }
    }
  };

  const handleCreateNew = () => {
    if (sending) return;
    conversation.newConversation();
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  const handleConfirmAction = async () => {
    const action = confirmModal;
    setConfirmModal(null);
    if (action === "clear") {
      try {
        await conversation.clearConversation();
        setError(undefined);
      } catch (value) {
        setError(value instanceof Error ? value.message : String(value));
      }
    } else if (action === "delete") {
      conversation.deleteConversation();
    }
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  const importFile = async (file?: File) => {
    if (!file || sending) return;
    try {
      await conversation.importConversation(file);
      setError(undefined);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const exportConversation = async () => {
    try {
      await conversationPackageApi.export(conversation.activeConversation);
      setError(undefined);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };

  return (
    <section className="source-tool-page source-agent-page" aria-labelledby="agent-title">
      <header className="source-agent-hero">
        <div className="source-agent-hero__left">
          <span className="source-agent-hero__icon">
            <Sparkles size={28} aria-hidden="true" />
          </span>
          <div>
            <h1 id="agent-title">AI Agent</h1>
            <p>Trợ lý AI xây dựng kịch bản, workflow và workspace sáng tạo.</p>
          </div>
        </div>
      </header>

      <Tabs
        ariaLabel="Chế độ AI Agent"
        value={view}
        onChange={setView}
        options={[
          { value: "chat", label: "Trò chuyện" },
          { value: "workflow", label: "Workflow" },
          { value: "director", label: "Director" },
          { value: "media", label: "Media Tools" },
          { value: "workspace", label: "Workspace" },
          { value: "skills", label: "Skills" },
        ]}
      />

      {view === "workspace" ? (
        <WorkspacePanel providerId={providerId} />
      ) : view === "workflow" ? (
        <WorkflowPanel
          providerId={providerId}
          activeConversation={conversation.activeConversation}
          onUpdatePlan={conversation.updateActiveConversationPlan}
        />
      ) : view === "director" ? (
        <DirectorPanel />
      ) : view === "media" ? (
        <MediaToolsPanel />
      ) : view === "skills" ? (
        <SkillsPanel />
      ) : (
        <div className="source-agent-layout">
          <div className="source-agent-chat-toolbar">
            <div className="source-agent-chat-toolbar__select-group">
              <Select
                value={conversation.activeId}
                disabled={!conversation.hydrated || sending}
                onValueChange={(val) => conversation.selectConversation(val)}
              >
                <SelectTrigger
                  aria-label="Cuộc trò chuyện"
                  className="source-agent-chat-toolbar__select"
                >
                  <SelectValue placeholder="Chọn cuộc trò chuyện" />
                </SelectTrigger>
                <SelectContent>
                  {conversation.conversations.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Tên cuộc trò chuyện"
                value={conversation.activeConversation.title}
                disabled={!conversation.hydrated || sending}
                onChange={(event) =>
                  conversation.renameConversation(event.target.value)
                }
                onBlur={conversation.normalizeActiveTitle}
                placeholder="Tên cuộc trò chuyện..."
              />
              <span
                className="source-agent-chat-status"
                data-hydrated={conversation.hydrated}
              >
                <span
                  className="source-agent-chat-status__dot"
                  aria-hidden="true"
                />
                {conversation.hydrated
                  ? activeModel
                    ? `Model: ${activeModel}`
                    : "Lịch sử được lưu cục bộ"
                  : "Đang tải lịch sử..."}
              </span>
            </div>
            <div className="source-agent-chat-toolbar__actions">
              <Button
                type="button"
                variant="secondary"
                title="Tạo cuộc trò chuyện mới"
                aria-label="Cuộc trò chuyện mới"
                disabled={!conversation.hydrated || sending}
                onClick={handleCreateNew}
              >
                <Plus size={15} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                title="Nhập cuộc trò chuyện (JSON)"
                aria-label="Import conversation JSON"
                disabled={!conversation.hydrated || sending}
                onClick={() => importRef.current?.click()}
              >
                <Upload size={15} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                title="Xuất cuộc trò chuyện (JSON)"
                aria-label="Export conversation JSON"
                disabled={!conversation.hydrated || sending}
                onClick={() => void exportConversation()}
              >
                <Download size={15} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                title="Xóa nội dung tin nhắn trong cuộc trò chuyện"
                aria-label="Xóa trao đổi"
                onClick={() => setConfirmModal("clear")}
                disabled={
                  !conversation.hydrated ||
                  sending ||
                  conversation.messages.length <= 1
                }
              >
                <Trash2 size={15} />
                Xóa trao đổi
              </Button>
              <Button
                type="button"
                variant="secondary"
                title="Xóa cuộc trò chuyện này"
                aria-label="Xóa conversation"
                onClick={() => setConfirmModal("delete")}
                disabled={!conversation.hydrated || sending}
              >
                <Trash2 size={15} />
              </Button>
            </div>
            <input
              ref={importRef}
              aria-label="Conversation JSON file"
              type="file"
              accept="application/json,.json"
              hidden
              disabled={!conversation.hydrated || sending}
              onChange={(event) => void importFile(event.target.files?.[0])}
            />
          </div>

          <div role="status" aria-live="polite" className="sr-only">
            {sending
              ? "Trợ lý AI đang suy nghĩ và trả lời..."
              : "Sẵn sàng nhận câu hỏi."}
          </div>

          <section
            ref={chatContainerRef}
            className="source-agent-chat"
            role="log"
            aria-label="Lịch sử trao đổi tin nhắn"
            onScroll={handleScroll}
          >
            {conversation.messages.map((message, index) => (
              <article
                key={message.id || `${message.role}-${index}`}
                data-role={message.role}
                role="article"
                aria-label={
                  message.role === "assistant"
                    ? "Câu trả lời từ Trợ lý AI"
                    : "Tin nhắn của bạn"
                }
              >
                {message.role === "assistant" ? (
                  <img
                    src={chatbotAvatarUrl}
                    alt=""
                    aria-hidden="true"
                    className="source-agent-chat__ai-avatar"
                  />
                ) : (
                  <span aria-hidden="true">
                    <UserRound size={17} />
                  </span>
                )}
                <div className="source-agent-chat__bubble">
                  <p>
                    {message.content ||
                      (sending && index === conversation.messages.length - 1
                        ? "Đang suy nghĩ..."
                        : "")}
                  </p>

                  {message.status === "cancelled" && (
                    <div className="source-agent-msg-tag source-agent-msg-tag--cancelled">
                      [Đã dừng phản hồi]
                    </div>
                  )}

                  {message.status === "failed" && (
                    <div className="source-agent-msg-tag source-agent-msg-tag--failed">
                      [Lỗi: {message.error || "Không thể nhận phản hồi"}]
                    </div>
                  )}

                  {message.role === "assistant" && message.content && (
                    <div className="source-agent-msg-actions">
                      <button
                        type="button"
                        className="source-agent-msg-btn"
                        title="Sao chép nội dung"
                        onClick={() =>
                          void copyMessageContent(message.content, index)
                        }
                      >
                        {copiedIndex === index ? (
                          <>
                            <Check size={12} /> Đã chép
                          </>
                        ) : (
                          <>
                            <Copy size={12} /> Sao chép
                          </>
                        )}
                      </button>

                      {index === conversation.messages.length - 1 &&
                        (message.status === "failed" ||
                          message.status === "cancelled") && (
                          <button
                            type="button"
                            className="source-agent-msg-btn"
                            title="Thử lại"
                            onClick={() => void retryLastMessage()}
                          >
                            <RotateCcw size={12} /> Thử lại
                          </button>
                        )}

                      {message.content.length > 40 && !sending && (
                        <button
                          type="button"
                          className="source-agent-msg-btn"
                          title="Chuyển ý tưởng này sang Workflow"
                          onClick={() => applyIdeaToWorkflow(message.content)}
                        >
                          <ListTodo size={12} /> Mở trong Workflow
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}
            <div ref={messagesEndRef} aria-hidden="true" />
          </section>

          <form
            className="source-agent-chat-form"
            onSubmit={(event) => void submit(event)}
          >
            <div className="source-agent-chat-form__input-wrap">
              <textarea
                ref={textareaRef}
                id="agent-message"
                aria-label="Nội dung tin nhắn hoặc yêu cầu"
                rows={3}
                value={input}
                disabled={!conversation.hydrated || sending}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  !conversation.hydrated
                    ? "Đang tải dữ liệu lịch sử..."
                    : "Nhập yêu cầu sáng tạo, kịch bản hoặc câu hỏi..."
                }
              />
            </div>
            <div className="source-agent-chat-form__footer">
              {error || conversation.persistenceError ? (
                <p role="alert" className="source-generation-error">
                  {error || conversation.persistenceError}
                </p>
              ) : (
                <span className="source-agent-chat-hint">
                  Enter để gửi · Shift+Enter để xuống dòng
                </span>
              )}
              <div className="source-agent-chat-form__actions">
                {sending ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={stopStreaming}
                    title="Dừng phản hồi"
                  >
                    <Square size={13} fill="currentColor" />
                    Dừng
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!conversation.hydrated || !input.trim()}
                    title="Gửi tin nhắn"
                  >
                    <Send size={14} />
                    Gửi
                  </Button>
                )}
              </div>
            </div>
          </form>

          <Dialog
            open={confirmModal !== null}
            onOpenChange={(open) => !open && setConfirmModal(null)}
          >
            <DialogContent showClose={false}>
              <DialogHeader>
                <DialogTitle>
                  {confirmModal === "clear"
                    ? "Xóa nội dung tin nhắn?"
                    : "Xóa cuộc trò chuyện?"}
                </DialogTitle>
                <DialogDescription>
                  {confirmModal === "clear"
                    ? "Toàn bộ tin nhắn trong cuộc trò chuyện hiện tại sẽ bị xóa và quay về tin nhắn chào mừng ban đầu."
                    : "Cuộc trò chuyện này sẽ bị xóa khỏi danh sách. Hành động này không thể hoàn tác."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setConfirmModal(null);
                    setTimeout(() => textareaRef.current?.focus(), 50);
                  }}
                >
                  Hủy
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => void handleConfirmAction()}
                >
                  Xác nhận xóa
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </section>
  );
}
