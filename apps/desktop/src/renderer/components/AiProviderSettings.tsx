import { useCallback, useMemo, useState } from "react";

import type { AiProviderKind } from "@translunar/contracts";
import { Badge, Button, SelectField, TextField } from "@translunar/ui";

import { notifyAiStatusChanged, useAiStatus } from "../lib/ai-status.js";
import { callEngine, describeError } from "../lib/engine.js";

/**
 * AI provider configuration, hosted by the application settings dialog.
 *
 * The form is guidance-first (Nielsen: recognition over recall): every
 * provider carries its endpoint placeholder and hint, the model input
 * offers known examples through a datalist while staying free-entry, and
 * the API key can be revealed while typing. The engine stays the only
 * validator — `ai.profile.add` performs the real credential check and this
 * form reports its verdict verbatim.
 */

const PROVIDERS: Array<{ value: AiProviderKind; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "openaiResponses", label: "OpenAI Responses" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
  { value: "deepl", label: "DeepL" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "qwen", label: "通义千问" },
  { value: "glm", label: "智谱 GLM" },
  { value: "kimi", label: "Kimi" },
  { value: "volcengine", label: "火山引擎" },
  { value: "openaiCompatible", label: "OpenAI 兼容端点" },
];

/** The engine caps the in-memory profile list; the form hides at the cap. */
const MAX_PROFILES = 6;

interface ProviderGuide {
  /** Ghost text for the Base URL input. */
  baseUrlPlaceholder: string;
  /** What to fill and to which path level. */
  baseUrlHint: string;
  /** Known model ids offered via datalist; free entry stays possible. */
  modelExamples: string[];
}

const OPENAI_STYLE_HINT =
  "填到 /v1 一级（不含 /chat/completions）；留空使用官方端点";

const PROVIDER_GUIDES: Record<AiProviderKind, ProviderGuide> = {
  openai: {
    baseUrlPlaceholder: "https://api.openai.com/v1",
    baseUrlHint: OPENAI_STYLE_HINT,
    modelExamples: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  },
  openaiResponses: {
    baseUrlPlaceholder: "https://api.openai.com/v1",
    baseUrlHint: OPENAI_STYLE_HINT,
    modelExamples: ["gpt-4.1", "gpt-4o", "o4-mini"],
  },
  anthropic: {
    baseUrlPlaceholder: "https://api.anthropic.com",
    baseUrlHint: "留空使用官方端点",
    modelExamples: ["claude-sonnet-4-5", "claude-3-7-sonnet-latest"],
  },
  gemini: {
    baseUrlPlaceholder: "https://generativelanguage.googleapis.com",
    baseUrlHint: "留空使用官方端点",
    modelExamples: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  deepl: {
    baseUrlPlaceholder: "https://api.deepl.com",
    baseUrlHint: "免费版填 https://api-free.deepl.com；留空使用付费版官方端点",
    modelExamples: [],
  },
  deepseek: {
    baseUrlPlaceholder: "https://api.deepseek.com/v1",
    baseUrlHint: OPENAI_STYLE_HINT,
    modelExamples: ["deepseek-chat", "deepseek-reasoner"],
  },
  qwen: {
    baseUrlPlaceholder: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    baseUrlHint: OPENAI_STYLE_HINT,
    modelExamples: ["qwen-max", "qwen-plus", "qwen-turbo"],
  },
  glm: {
    baseUrlPlaceholder: "https://open.bigmodel.cn/api/paas/v4",
    baseUrlHint: "填到 /v4 一级；留空使用官方端点",
    modelExamples: ["glm-4-plus", "glm-4-flash"],
  },
  kimi: {
    baseUrlPlaceholder: "https://api.moonshot.cn/v1",
    baseUrlHint: OPENAI_STYLE_HINT,
    modelExamples: ["moonshot-v1-8k", "moonshot-v1-32k"],
  },
  volcengine: {
    baseUrlPlaceholder: "https://ark.cn-beijing.volces.com/api/v3",
    baseUrlHint: "填到 /api/v3 一级；模型填推理接入点 ID（ep-…）",
    modelExamples: [],
  },
  openaiCompatible: {
    baseUrlPlaceholder: "http://localhost:11434/v1",
    baseUrlHint:
      "任何 OpenAI 兼容端点（如 Ollama / vLLM），必填，填到 /v1 一级",
    modelExamples: [],
  },
};

export function AiProviderSettings({
  onStatusMessage,
}: {
  onStatusMessage: (message: string) => void;
}) {
  const {
    status,
    configured,
    profiles,
    defaultProfileId,
    refresh,
    setProfiles,
  } = useAiStatus();
  const [provider, setProvider] = useState<AiProviderKind>("openai");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const guide = PROVIDER_GUIDES[provider];
  const modelListId = "ai-model-examples";
  const modelExamples = useMemo(() => guide.modelExamples, [guide]);

  const addProfile = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSavedNote(null);
    try {
      const list = await callEngine("ai.profile.add", {
        provider,
        model,
        label: label.trim() ? label.trim() : null,
        baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
        apiKey,
      });
      setProfiles(list);
      setApiKey("");
      setModel("");
      setLabel("");
      setBaseUrl("");
      await refresh();
      // The workbench dock mounts its own provider instance; tell it.
      notifyAiStatusChanged();
      setSavedNote(`已验证并保存：${provider} / ${model}`);
      onStatusMessage(`模型已添加：${provider} / ${model}`);
    } catch (addError) {
      setError(describeError(addError));
    } finally {
      setBusy(false);
    }
  }, [
    provider,
    model,
    label,
    baseUrl,
    apiKey,
    onStatusMessage,
    refresh,
    setProfiles,
  ]);

  const removeProfile = useCallback(
    async (profileId: string) => {
      setError(null);
      try {
        const list = await callEngine("ai.profile.remove", { profileId });
        setProfiles(list);
        await refresh();
        notifyAiStatusChanged();
        onStatusMessage("模型已移除");
      } catch (removeError) {
        setError(describeError(removeError));
      }
    },
    [onStatusMessage, refresh, setProfiles],
  );

  return (
    <div className="ai-provider-settings">
      <div className="settings-section__intro">
        {configured ? (
          <Badge tone="ok">
            {profiles.length > 1
              ? `已配置 ${profiles.length} 个模型`
              : `${status?.provider} · ${status?.model}`}
          </Badge>
        ) : (
          <Badge tone="warn">未配置</Badge>
        )}
        <p className="settings-section__note">
          凭据保存在本机引擎内存中，用于 AI 翻译/润色与 AGENT 模式。保存时会向
          供应商发起一次真实校验，失败会原样报错——本产品从不假装配置成功。
        </p>
      </div>

      {profiles.length > 0 ? (
        <div className="ai-profiles" data-testid="ai-profiles">
          {profiles.map((profile) => (
            <div key={profile.profileId} className="ai-profiles__row">
              <span className="ai-profiles__label">{profile.label}</span>
              {profile.profileId === defaultProfileId ? (
                <Badge tone="neutral">默认</Badge>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void removeProfile(profile.profileId)}
              >
                移除
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {profiles.length < MAX_PROFILES ? (
        <form
          className="form-stack"
          aria-label="添加 AI 模型"
          onSubmit={(event) => {
            event.preventDefault();
            void addProfile();
          }}
        >
          <SelectField
            label="供应商"
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as AiProviderKind)
            }
          >
            {PROVIDERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="模型"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            required
            placeholder={modelExamples[0] ?? "模型 ID"}
            list={modelExamples.length > 0 ? modelListId : undefined}
            hint={
              modelExamples.length > 0
                ? `可从建议中选择，也可自由输入（如 ${modelExamples.join("、")}）`
                : provider === "volcengine"
                  ? "填推理接入点 ID（ep-…）"
                  : "按供应商文档填写模型 ID"
            }
          />
          {modelExamples.length > 0 ? (
            <datalist id={modelListId}>
              {modelExamples.map((example) => (
                <option key={example} value={example} />
              ))}
            </datalist>
          ) : null}
          <TextField
            label="显示名（可选）"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="如：主力翻译模型"
            hint="出现在 AI 面板与候选卡片上；留空自动生成"
          />
          <TextField
            label="Base URL"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={guide.baseUrlPlaceholder}
            required={provider === "openaiCompatible"}
            hint={guide.baseUrlHint}
          />
          <div className="ai-provider-settings__key">
            <TextField
              label="API Key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              required
              placeholder="sk-…"
              autoComplete="off"
              hint="仅保存在本机，不随项目导出"
            />
            <Button
              size="sm"
              variant="ghost"
              type="button"
              aria-pressed={showKey}
              onClick={() => setShowKey((open) => !open)}
            >
              {showKey ? "隐藏" : "显示"}
            </Button>
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !model.trim() || !apiKey.trim()}
          >
            {busy ? "验证中…" : profiles.length === 0 ? "保存配置" : "添加模型"}
          </Button>
        </form>
      ) : (
        <p className="settings-section__note">
          已达到 {MAX_PROFILES} 个模型上限；移除后可再添加。
        </p>
      )}

      {savedNote ? (
        <div className="honest-note" data-tone="ok" role="status">
          {savedNote}
        </div>
      ) : null}
      {error ? (
        <div className="honest-note" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
