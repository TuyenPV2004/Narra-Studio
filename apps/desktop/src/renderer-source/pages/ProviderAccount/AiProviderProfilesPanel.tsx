import { CheckCircle2, PlugZap, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  aiProviderApi,
  type AiProviderModel,
  type AiProviderCapability,
  type AiProviderProtocol,
  type AiProviderProfile,
} from "@/services/electron-api/ai-providers";

const capabilityLabels: Record<AiProviderCapability, string> = {
  text: "Text",
  vision: "Vision",
  "text-to-speech": "Text-to-speech",
  "lip-sync": "Lip-sync",
};

const protocolLabels: Record<AiProviderProtocol, string> = {
  "openai-compatible": "OpenAI-compatible (Text/Vision)",
  "narra-tts-v1": "TTS-compatible v1",
  "sync-v2": "Sync-compatible v2",
};

const protocolCapabilities: Record<AiProviderProtocol, AiProviderCapability[]> =
  {
    "openai-compatible": ["text", "vision"],
    "narra-tts-v1": ["text-to-speech"],
    "sync-v2": ["lip-sync"],
  };

const emptyDraft = {
  id: "",
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  capabilities: ["text", "vision"] as AiProviderCapability[],
  protocol: "openai-compatible" as AiProviderProtocol,
};

export function AiProviderProfilesPanel() {
  const [profiles, setProfiles] = useState<AiProviderProfile[]>([]);
  const [activeId, setActiveId] = useState("");
  const [activeByCapability, setActiveByCapability] = useState<
    Partial<Record<AiProviderCapability, string>>
  >({});
  const [draft, setDraft] = useState(emptyDraft);
  const [models, setModels] = useState<AiProviderModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "error" | "success";
  }>();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const value = await aiProviderApi.list();
      setProfiles(value.profiles);
      setActiveId(value.activeId);
      setActiveByCapability(value.activeByCapability);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (profile: AiProviderProfile) => {
    setDraft({
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      apiKey: "",
      model: profile.model,
      capabilities: profile.capabilities,
      protocol: profile.protocol,
    });
    setModels(
      profile.model ? [{ id: profile.model, name: profile.model }] : [],
    );
    setFeedback(undefined);
  };

  const connection = () => ({
    ...(draft.id ? { id: draft.id } : {}),
    ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}),
    ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
  });

  const discover = async () => {
    if (!draft.baseUrl.trim()) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const discovered = await aiProviderApi.models(connection());
      setModels(discovered);
      setDraft((current) => ({
        ...current,
        model: discovered.some((model) => model.id === current.model)
          ? current.model
          : discovered[0]?.id || "",
      }));
      setFeedback({
        tone: "success",
        message: `Đã kết nối và tìm thấy ${discovered.length} model.`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!draft.baseUrl.trim()) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const count = await aiProviderApi.test(connection());
      setFeedback({
        tone: "success",
        message: `Kết nối thành công · ${count} model khả dụng.`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (
      !draft.name.trim() ||
      !draft.baseUrl.trim() ||
      !draft.model.trim() ||
      draft.capabilities.length === 0 ||
      (!draft.id && !draft.apiKey.trim())
    )
      return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await aiProviderApi.save({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        capabilities: draft.capabilities,
        protocol: draft.protocol,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      });
      setDraft(emptyDraft);
      setModels([]);
      await load();
      setFeedback({ tone: "success", message: "Đã lưu AI provider." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      setBusy(false);
    }
  };

  const activate = async (
    id: string,
    capability: AiProviderCapability = "text",
  ) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await aiProviderApi.setActive(id, capability);
      if (capability === "text") setActiveId(id);
      setActiveByCapability((current) => ({ ...current, [capability]: id }));
      setFeedback({ tone: "success", message: "Đã chọn AI provider." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await aiProviderApi.remove(id);
      if (draft.id === id) {
        setDraft(emptyDraft);
        setModels([]);
      }
      await load();
      setFeedback({ tone: "success", message: "Đã xóa AI provider." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      setBusy(false);
    }
  };

  return (
    <section
      className="source-ai-providers"
      aria-labelledby="ai-provider-title"
    >
      <header>
        <div>
          <h2 id="ai-provider-title">AI Provider</h2>
          <p>
            Kết nối API tương thích OpenAI bằng Base URL, API key và model.
            Google VEO3 vẫn hoạt động độc lập.
          </p>
        </div>
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={15} className={busy ? "is-spinning" : ""} />
          Làm mới
        </Button>
      </header>
      {feedback && (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          data-tone={feedback.tone}
          className="source-ai-providers__feedback"
        >
          {feedback.message}
        </p>
      )}
      <div className="source-ai-providers__layout">
        <div className="source-ai-providers__list">
          {!profiles.length && <p>Chưa có AI provider được cấu hình.</p>}
          {profiles.map((profile) => (
            <article key={profile.id} data-active={profile.id === activeId}>
              <div>
                <strong>{profile.name}</strong>
                <code>{profile.baseUrl}</code>
                <small>{protocolLabels[profile.protocol]}</small>
                <small className="source-ai-providers__capabilities">
                  {profile.capabilities
                    .map((capability) => capabilityLabels[capability])
                    .join(" · ")}
                </small>
                <span>{profile.model || "Chưa chọn model"}</span>
                <small>
                  {profile.apiKeyPreview || "API key chưa sẵn sàng"}
                </small>
              </div>
              <div>
                {profile.id === activeId ? (
                  <span className="narra-badge narra-badge--success">
                    <CheckCircle2 size={13} /> Đang dùng
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={busy || !profile.model}
                    onClick={() => void activate(profile.id)}
                  >
                    Chọn
                  </Button>
                )}
                {profile.capabilities
                  .filter((capability) => capability !== "text")
                  .map((capability) => (
                    <Button
                      key={capability}
                      variant="ghost"
                      disabled={
                        busy || activeByCapability[capability] === profile.id
                      }
                      onClick={() => void activate(profile.id, capability)}
                    >
                      {activeByCapability[capability] === profile.id
                        ? `Đang dùng ${capabilityLabels[capability]}`
                        : `Dùng cho ${capabilityLabels[capability]}`}
                    </Button>
                  ))}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => edit(profile)}
                >
                  Sửa
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  aria-label={`Xóa ${profile.name}`}
                  onClick={() => void remove(profile.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>
        <form
          className="source-ai-providers__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <header>
            <h3>{draft.id ? "Chỉnh sửa provider" : "Thêm provider"}</h3>
            {draft.id && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(emptyDraft);
                  setModels([]);
                }}
              >
                <Plus size={14} /> Tạo mới
              </Button>
            )}
          </header>
          <label>
            Tên provider
            <Input
              value={draft.name}
              maxLength={80}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Ví dụ: OpenAI, Anthropic-compatible, LiteLLM"
            />
          </label>
          <label>
            Base URL
            <Input
              type="url"
              value={draft.baseUrl}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  baseUrl: event.target.value,
                }))
              }
              placeholder="https://provider.example/v1"
            />
          </label>
          <label>
            Loại kết nối
            <select
              value={draft.protocol}
              onChange={(event) => {
                const protocol = event.target.value as AiProviderProtocol;
                setDraft((current) => ({
                  ...current,
                  protocol,
                  capabilities: protocolCapabilities[protocol],
                }));
              }}
            >
              {(Object.keys(protocolLabels) as AiProviderProtocol[]).map(
                (protocol) => (
                  <option key={protocol} value={protocol}>
                    {protocolLabels[protocol]}
                  </option>
                ),
              )}
            </select>
            <small>
              {draft.protocol === "openai-compatible"
                ? "Dùng /models và /chat/completions cho Text/Vision."
                : draft.protocol === "narra-tts-v1"
                  ? "Dùng contract /v1/text-to-speech cho TTS."
                  : "Dùng contract /v2/generate và polling cho Lip-sync."}
            </small>
          </label>
          <label>
            API key {draft.id && <small>Để trống để giữ key hiện tại</small>}
            <Input
              type="password"
              value={draft.apiKey}
              autoComplete="new-password"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  apiKey: event.target.value,
                }))
              }
              placeholder={draft.id ? "••••••••" : "Nhập API key"}
            />
          </label>
          <div className="source-ai-providers__test-actions">
            <Button
              variant="secondary"
              disabled={
                busy ||
                !draft.baseUrl.trim() ||
                draft.protocol !== "openai-compatible"
              }
              onClick={() => void test()}
            >
              <PlugZap size={15} /> Kiểm tra kết nối
            </Button>
            <Button
              variant="secondary"
              disabled={
                busy ||
                !draft.baseUrl.trim() ||
                draft.protocol !== "openai-compatible"
              }
              onClick={() => void discover()}
            >
              Tải danh sách model
            </Button>
          </div>
          <label>
            Model
            {models.length ? (
              <select
                value={draft.model}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={draft.model}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
                placeholder="Chọn sau khi tải model"
              />
            )}
          </label>
          <fieldset className="source-ai-providers__capability-options">
            <legend>Capabilities</legend>
            {(Object.keys(capabilityLabels) as AiProviderCapability[]).map(
              (capability) => (
                <label key={capability}>
                  <input
                    type="checkbox"
                    disabled={
                      !protocolCapabilities[draft.protocol].includes(capability)
                    }
                    checked={draft.capabilities.includes(capability)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        capabilities: event.target.checked
                          ? [...new Set([...current.capabilities, capability])]
                          : current.capabilities.filter(
                              (value) => value !== capability,
                            ),
                      }))
                    }
                  />
                  {capabilityLabels[capability]}
                </label>
              ),
            )}
          </fieldset>
          <Button
            type="submit"
            disabled={
              busy ||
              !draft.name.trim() ||
              !draft.baseUrl.trim() ||
              !draft.model.trim() ||
              draft.capabilities.length === 0 ||
              (!draft.id && !draft.apiKey.trim())
            }
          >
            Lưu provider
          </Button>
        </form>
      </div>
    </section>
  );
}
