import {
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronUp,
  CloudCheck,
  CloudDownload,
  Earth,
  GlobeLock,
  Inbox,
  KeyRound,
  MousePointerClick,
  RotateCcw,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { toast } from "@/components/ui/Toast";
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

function cleanErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "");
  return (
    raw
      .replace(/^Error occurred in handler for '[^']+': (?:Error: )?/, "")
      .trim() || "Đã xảy ra lỗi kết nối."
  );
}

export function AiProviderProfilesPanel() {
  const [profiles, setProfiles] = useState<AiProviderProfile[]>([]);
  const [activeId, setActiveId] = useState("");
  const [activeByCapability, setActiveByCapability] = useState<
    Partial<Record<AiProviderCapability, string>>
  >({});
  const [draft, setDraft] = useState(emptyDraft);
  const [models, setModels] = useState<AiProviderModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [deletingProfile, setDeletingProfile] =
    useState<AiProviderProfile | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? true),
    }));
  };

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const value = await aiProviderApi.list();
      setProfiles(value.profiles);
      setActiveId(value.activeId);
      setActiveByCapability(value.activeByCapability);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Tải danh sách provider thất bại", { description: msg });
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
  };

  const connection = () => ({
    ...(draft.id ? { id: draft.id } : {}),
    ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}),
    ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
  });

  const discover = async () => {
    if (!draft.baseUrl.trim()) {
      toast.warning("Vui lòng nhập Base URL trước khi tải model.");
      return;
    }
    if (!draft.id && !draft.apiKey.trim()) {
      toast.warning("Vui lòng nhập API key trước khi tải model.");
      return;
    }
    setBusy(true);
    try {
      const discovered = await aiProviderApi.models(connection());
      setModels(discovered);
      setDraft((current) => ({
        ...current,
        model: discovered.some((model) => model.id === current.model)
          ? current.model
          : discovered[0]?.id || "",
      }));
      toast.success("Tải model thành công!", {
        description: `Đã kết nối và tìm thấy ${discovered.length} model.`,
      });
    } catch (error) {
      const msg = cleanErrorMessage(error);
      toast.error("Tải danh sách model thất bại", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!draft.baseUrl.trim()) {
      toast.warning("Vui lòng nhập Base URL trước khi kiểm tra kết nối.");
      return;
    }
    if (!draft.id && !draft.apiKey.trim()) {
      toast.warning("Vui lòng nhập API key trước khi kiểm tra kết nối.");
      return;
    }
    setBusy(true);
    try {
      const count = await aiProviderApi.test(connection());
      toast.success("Kết nối thành công!", {
        description: `${count} model khả dụng.`,
      });
    } catch (error) {
      const msg = cleanErrorMessage(error);
      toast.error("Kiểm tra kết nối thất bại", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast.warning("Vui lòng nhập Tên provider.");
      return;
    }
    if (!draft.baseUrl.trim()) {
      toast.warning("Vui lòng nhập Base URL.");
      return;
    }
    if (!draft.model.trim()) {
      toast.warning("Vui lòng chọn hoặc nhập Model.");
      return;
    }
    if (draft.capabilities.length === 0) {
      toast.warning("Vui lòng chọn ít nhất một Khả năng hỗ trợ.");
      return;
    }
    if (!draft.id && !draft.apiKey.trim()) {
      toast.warning("Vui lòng nhập API key.");
      return;
    }
    setBusy(true);
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
      toast.success("Đã lưu AI provider thành công!");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Lưu AI provider thất bại", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const activate = async (
    id: string,
    capability: AiProviderCapability = "text",
  ) => {
    setBusy(true);
    try {
      await aiProviderApi.setActive(id, capability);
      if (capability === "text") setActiveId(id);
      setActiveByCapability((current) => ({ ...current, [capability]: id }));
      toast.success(
        `Đã kích hoạt AI provider cho ${capabilityLabels[capability]}!`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Kích hoạt AI provider thất bại", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await aiProviderApi.remove(id);
      if (draft.id === id) {
        setDraft(emptyDraft);
        setModels([]);
      }
      await load();
      toast.success("Đã xóa AI provider thành công.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Xóa AI provider thất bại", { description: msg });
      setBusy(false);
    }
  };

  return (
    <section className="source-ai-providers">
      <div className="source-ai-providers__layout">
        <div className="source-ai-providers__list">
          {!profiles.length && (
            <div className="source-ai-providers__empty">
              <Inbox
                size={42}
                className="source-ai-providers__empty-icon"
                aria-hidden="true"
              />
              <p>Chưa có AI provider được cấu hình</p>
            </div>
          )}
          {profiles.map((profile) => {
            const isActive = profile.id === activeId;
            const isExpanded = expandedIds[profile.id] ?? true;
            const isEditing = draft.id === profile.id;
            return (
              <article
                key={profile.id}
                className="source-provider-card"
                data-active={isActive}
                data-expanded={isExpanded}
                data-editing={isEditing}
              >
                <div className="source-provider-card__header">
                  <div
                    className="source-provider-card__identity"
                    onClick={() => toggleExpand(profile.id)}
                    style={{ cursor: "pointer" }}
                    title={isExpanded ? "Bấm để thu gọn" : "Bấm để mở rộng"}
                  >
                    <CloudCheck
                      size={23}
                      className="source-provider-card__cloud-icon"
                      aria-hidden="true"
                    />
                    <div className="source-provider-card__titles">
                      <h4 className="source-provider-card__name">
                        {profile.name}
                      </h4>
                      <span className="source-provider-card__protocol">
                        {protocolLabels[profile.protocol]}
                      </span>
                      <div className="source-provider-card__capabilities">
                        {isActive && (
                          <span className="source-provider-card__cap-pill source-provider-card__cap-pill--active">
                            Hoạt động
                          </span>
                        )}
                        {profile.capabilities.map((capability) => (
                          <span
                            key={capability}
                            className="source-provider-card__cap-pill"
                          >
                            {capabilityLabels[capability]}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="source-provider-card__actions">
                    {!isActive && (
                      <Button
                        variant="secondary"
                        className="source-provider-card__btn-select"
                        disabled={busy || !profile.model}
                        onClick={() => void activate(profile.id)}
                      >
                        <MousePointerClick size={13} aria-hidden="true" /> Chọn
                      </Button>
                    )}
                    {isEditing ? (
                      <Button
                        variant="secondary"
                        className="source-provider-card__btn-back"
                        disabled={busy}
                        title={`Quay lại tạo mới provider`}
                        onClick={() => {
                          setDraft(emptyDraft);
                          setModels([]);
                        }}
                      >
                        <RotateCcw size={13} aria-hidden="true" /> Quay lại
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="source-provider-card__btn-edit"
                        disabled={busy}
                        title={`Chỉnh sửa ${profile.name}`}
                        onClick={() => edit(profile)}
                      >
                        <SquarePen size={13} /> Chỉnh sửa
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="source-provider-card__btn-delete"
                      disabled={busy}
                      title={`Xóa ${profile.name}`}
                      aria-label={`Xóa ${profile.name}`}
                      onClick={() => setDeletingProfile(profile)}
                    >
                      <Trash2 size={13} /> Xóa
                    </Button>
                    <Button
                      variant="ghost"
                      className="source-provider-card__btn-toggle"
                      disabled={busy}
                      title={isExpanded ? "Đóng lên" : "Kéo xuống"}
                      aria-label={isExpanded ? "Đóng lên" : "Kéo xuống"}
                      onClick={() => toggleExpand(profile.id)}
                    >
                      {isExpanded ? (
                        <ChevronUp size={15} />
                      ) : (
                        <ChevronDown size={15} />
                      )}
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="source-provider-card__body">
                    <div className="source-provider-card__info-row">
                      <span className="source-provider-card__label">
                        <Brain size={13} aria-hidden="true" /> Model:
                      </span>
                      <span className="source-provider-card__value">
                        {profile.model || "Chưa chọn model"}
                      </span>
                    </div>

                    <div className="source-provider-card__info-row">
                      <span className="source-provider-card__label">
                        <KeyRound size={13} aria-hidden="true" /> API key:
                      </span>
                      <span className="source-provider-card__value source-provider-card__value--key">
                        {profile.apiKeyPreview || "API key chưa sẵn sàng"}
                      </span>
                    </div>

                    <div className="source-provider-card__info-row source-provider-card__info-row--full">
                      <span className="source-provider-card__label">
                        <Earth size={13} aria-hidden="true" /> Base URL:
                      </span>
                      <span
                        className="source-provider-card__value source-provider-card__value--url"
                        title={profile.baseUrl}
                      >
                        {profile.baseUrl}
                      </span>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        <form
          className="source-ai-providers__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            <span>
              Tên provider <span className="source-required-mark">*</span>
            </span>
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
            <span>
              Base URL <span className="source-required-mark">*</span>
            </span>
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
          <div>
            <label className="source-field-label">
              <span>Loại kết nối</span>
            </label>
            <Select
              value={draft.protocol}
              onValueChange={(val) => {
                const protocol = val as AiProviderProtocol;
                setDraft((current) => ({
                  ...current,
                  protocol,
                  capabilities: protocolCapabilities[protocol],
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn loại kết nối" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(protocolLabels) as AiProviderProtocol[]).map(
                  (protocol) => (
                    <SelectItem key={protocol} value={protocol}>
                      {protocolLabels[protocol]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <label>
            <span>
              API key{" "}
              {!draft.id && <span className="source-required-mark">*</span>}
              {draft.id && <small> (Để trống để giữ key hiện tại)</small>}
            </span>
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
              className="source-ai-btn-test"
              disabled={
                busy ||
                !draft.baseUrl.trim() ||
                draft.protocol !== "openai-compatible"
              }
              onClick={() => void test()}
            >
              <GlobeLock size={15} /> Kiểm tra kết nối
            </Button>
            <Button
              variant="secondary"
              className="source-ai-btn-discover"
              disabled={
                busy ||
                !draft.baseUrl.trim() ||
                draft.protocol !== "openai-compatible"
              }
              onClick={() => void discover()}
            >
              <CloudDownload size={15} /> Tải danh sách model
            </Button>
          </div>
          <div>
            <label className="source-field-label">
              <span>
                Model <span className="source-required-mark">*</span>
              </span>
            </label>
            {models.length ? (
              <Select
                value={draft.model}
                onValueChange={(model) =>
                  setDraft((current) => ({
                    ...current,
                    model,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn model khả dụng" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          </div>
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
            Lưu cấu hình
          </Button>
        </form>
      </div>

      <Dialog
        open={Boolean(deletingProfile)}
        onOpenChange={(open) => {
          if (!open) setDeletingProfile(null);
        }}
      >
        <DialogContent showClose={false}>
          <DialogHeader>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "32px",
                  height: "32px",
                  borderRadius: "9999px",
                  background: "var(--danger)",
                  color: "#ffffff",
                  flexShrink: 0,
                  boxShadow:
                    "0 2px 6px color-mix(in srgb, var(--danger) 35%, transparent)",
                }}
              >
                <AlertTriangle size={17} aria-hidden="true" />
              </div>
              <div>
                <DialogTitle>Xác nhận xóa AI Provider</DialogTitle>
                <DialogDescription>
                  Hành động này không thể hoàn tác.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div
            style={{
              padding: "8px 0",
              fontSize: "0.9rem",
              color: "var(--foreground)",
              lineHeight: 1.5,
            }}
          >
            Bạn có chắc chắn muốn xóa cấu hình AI provider{" "}
            <strong>"{deletingProfile?.name}"</strong> không? Toàn bộ API key và
            thông số đã lưu sẽ bị xóa khỏi hệ thống.
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setDeletingProfile(null)}
            >
              Hủy
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (deletingProfile) {
                  const id = deletingProfile.id;
                  setDeletingProfile(null);
                  void remove(id);
                }
              }}
            >
              Xóa provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
