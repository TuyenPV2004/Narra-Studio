import {
  Download,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import chatbotAvatarUrl from "@/assets/chatbot-icon.svg";
import { FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
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
  role: "assistant",
  content:
    "Em có thể hỗ trợ phát triển ý tưởng, prompt và kế hoạch sản xuất. Hãy mô tả mục tiêu của anh.",
};

export function AIAgentSourcePage({ providerId }: { providerId: ProviderId }) {
  const [view, setView] = useState<
    "chat" | "director" | "media" | "skills" | "workflow" | "workspace"
  >("chat");
  const conversation = useAgentConversationLibrary(welcome);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const importRef = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    const user: AgentMessage = { role: "user", content };
    conversation.setMessages((current) => [
      ...current,
      user,
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setSending(true);
    setError(undefined);
    try {
      const reply = await agentApi.chatStream(
        content,
        conversation.messages,
        (next) =>
          conversation.setMessages((current) =>
            current.map((message, index) =>
              index === current.length - 1
                ? { role: "assistant", content: next }
                : message,
            ),
          ),
      );
      conversation.setMessages((current) =>
        current.map((message, index) =>
          index === current.length - 1
            ? { role: "assistant", content: reply }
            : message,
        ),
      );
    } catch (value) {
      conversation.setMessages((current) =>
        current.filter(
          (message, index) => index !== current.length - 1 || message.content,
        ),
      );
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSending(false);
    }
  };
  const clear = async () => {
    try {
      await conversation.clearConversation();
      setError(undefined);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      await conversation.importConversation(file);
      setError(undefined);
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
        <WorkflowPanel providerId={providerId} />
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
                onChange={(event) =>
                  conversation.renameConversation(event.target.value)
                }
                placeholder="Tên cuộc trò chuyện..."
              />
              <span className="source-agent-chat-status">
                <span className="source-agent-chat-status__dot" />
                {conversation.hydrated
                  ? "Lịch sử đã lưu local"
                  : "Đang tải lịch sử..."}
              </span>
            </div>
            <div className="source-agent-chat-toolbar__actions">
              <Button
                type="button"
                variant="secondary"
                title="Cuộc trò chuyện mới"
                aria-label="Cuộc trò chuyện mới"
                onClick={conversation.newConversation}
              >
                <Plus size={15} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                title="Import conversation JSON"
                aria-label="Import conversation JSON"
                onClick={() => importRef.current?.click()}
              >
                <Upload size={15} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                title="Export conversation JSON"
                aria-label="Export conversation JSON"
                onClick={() => void exportConversation()}
              >
                <Download size={15} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void clear()}
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
                title="Xóa conversation"
                aria-label="Xóa conversation"
                onClick={conversation.deleteConversation}
                disabled={!conversation.hydrated}
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
              onChange={(event) => void importFile(event.target.files?.[0])}
            />
          </div>
          <section className="source-agent-chat" aria-live="polite">
            {conversation.messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                data-role={message.role}
              >
                {message.role === "assistant" ? (
                  <img
                    src={chatbotAvatarUrl}
                    alt="AI Assistant"
                    className="source-agent-chat__ai-avatar"
                  />
                ) : (
                  <span>
                    <UserRound size={17} />
                  </span>
                )}
                <p>
                  {message.content ||
                    (sending && index === conversation.messages.length - 1
                      ? "Đang suy nghĩ..."
                      : "")}
                </p>
              </article>
            ))}
          </section>
          <form
            className="source-agent-chat-form"
            onSubmit={(event) => void submit(event)}
          >
            <div className="source-agent-chat-form__input-wrap">
              <textarea
                id="agent-message"
                aria-label="Nội dung tin nhắn hoặc yêu cầu"
                rows={3}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Nhập yêu cầu sáng tạo, kịch bản hoặc câu hỏi..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (input.trim() && !sending) {
                      void submit(e);
                    }
                  }
                }}
              />
            </div>
            {(error || conversation.persistenceError) && (
              <p role="alert" className="source-generation-error">
                {error || conversation.persistenceError}
              </p>
            )}
          </form>
        </div>
      )}
    </section>
  );
}
