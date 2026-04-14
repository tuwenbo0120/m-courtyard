import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  BellRing,
  History,
  Volume2,
} from "lucide-react";
import {
  useNotificationStore,
  DEFAULT_NATIVE_NOTIFICATION_SOUND,
  type NotificationChannel,
  type ChannelType,
  type NotificationEvents,
} from "@/stores/notificationStore";

// ─── Channel meta ────────────────────────────────────────────────────────────

interface ChannelMeta {
  label: string;
  fields: FieldDef[];
}

interface FieldDef {
  key: keyof NotificationChannel;
  labelKey: string;
  placeholder: string;
  password?: boolean;
}

const CHANNEL_META: Record<ChannelType, ChannelMeta> = {
  webhook: {
    label: "Webhook",
    fields: [
      {
        key: "url",
        labelKey: "fieldUrl",
        placeholder: "https://example.com/hook",
      },
    ],
  },
  slack: {
    label: "Slack",
    fields: [
      {
        key: "url",
        labelKey: "fieldUrl",
        placeholder: "https://hooks.slack.com/services/...",
      },
    ],
  },
  discord: {
    label: "Discord",
    fields: [
      {
        key: "url",
        labelKey: "fieldUrl",
        placeholder: "https://discord.com/api/webhooks/...",
      },
    ],
  },
  telegram: {
    label: "Telegram",
    fields: [
      {
        key: "token",
        labelKey: "fieldBotToken",
        placeholder: "123456:ABC-DEF...",
        password: true,
      },
      { key: "chat_id", labelKey: "fieldChatId", placeholder: "-100123456789" },
    ],
  },
  feishu: {
    label: "飞书",
    fields: [
      {
        key: "url",
        labelKey: "fieldUrl",
        placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
      },
    ],
  },
  wecom: {
    label: "企业微信",
    fields: [
      {
        key: "url",
        labelKey: "fieldUrl",
        placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...",
      },
    ],
  },
  ntfy: {
    label: "ntfy",
    fields: [
      {
        key: "url",
        labelKey: "fieldTopicUrl",
        placeholder: "https://ntfy.sh/my-topic",
      },
    ],
  },
  bark: {
    label: "Bark",
    fields: [
      {
        key: "url",
        labelKey: "fieldServerUrl",
        placeholder: "https://api.day.app",
      },
      {
        key: "key",
        labelKey: "fieldDeviceKey",
        placeholder: "your-device-key",
        password: true,
      },
    ],
  },
  pushover: {
    label: "Pushover",
    fields: [
      {
        key: "token",
        labelKey: "fieldApiToken",
        placeholder: "azGDURgv...",
        password: true,
      },
      {
        key: "user_key",
        labelKey: "fieldUserKey",
        placeholder: "uQiRzpo4...",
        password: true,
      },
    ],
  },
};

const CHANNEL_TYPES = Object.keys(CHANNEL_META) as ChannelType[];

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Pill toggle switch ───────────────────────────────────────────────────────

function PillSwitch({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        enabled ? "bg-success" : "bg-muted-foreground/30"
      }`}
      aria-checked={enabled}
      role="switch"
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
          enabled ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ─── Channel form ─────────────────────────────────────────────────────────────

type TestState = "idle" | "sending" | "ok" | "error";

function ChannelForm({
  channel,
  onSave,
  onCancel,
}: {
  channel: Partial<NotificationChannel>;
  onSave: (ch: NotificationChannel) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("notification");
  const [form, setForm] = useState<Partial<NotificationChannel>>({
    type: "webhook",
    name: "",
    enabled: true,
    ...channel,
  });
  const [testState, setTestState] = useState<TestState>("idle");

  const meta = CHANNEL_META[form.type as ChannelType] ?? CHANNEL_META.webhook;

  const update = (key: keyof NotificationChannel, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setType = (type: ChannelType) =>
    setForm((f) => ({
      ...f,
      type,
      url: "",
      token: "",
      chat_id: "",
      user_key: "",
      key: "",
    }));

  const isValid = () => {
    if (!form.name?.trim()) return false;
    return meta.fields.every((f) =>
      (form[f.key] as string | undefined)?.trim(),
    );
  };

  const handleTest = async () => {
    if (!isValid()) return;
    setTestState("sending");
    try {
      const { dispatchToChannel } = await import("@/stores/notificationStore");
      await dispatchToChannel(
        {
          id: "___test___",
          type: form.type as ChannelType,
          name: form.name!,
          enabled: true,
          url: form.url,
          token: form.token,
          chat_id: form.chat_id,
          user_key: form.user_key,
          key: form.key,
        },
        t("testTitle"),
        t("testBody"),
      );
      setTestState("ok");
    } catch {
      setTestState("error");
    }
    setTimeout(() => setTestState("idle"), 3000);
  };

  const inputCls =
    "w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50";

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-4">
      {/* Channel type — button grid */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("fieldType")}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {CHANNEL_TYPES.map((ct) => (
            <button
              key={ct}
              type="button"
              onClick={() => setType(ct)}
              className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                form.type === ct
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-border/80 hover:bg-muted/30"
              }`}
            >
              {CHANNEL_META[ct].label}
            </button>
          ))}
        </div>
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("fieldName")}
        </label>
        <input
          type="text"
          value={form.name ?? ""}
          onChange={(e) => update("name", e.target.value)}
          placeholder={t("fieldNamePlaceholder")}
          className={inputCls}
        />
      </div>

      {/* Dynamic fields */}
      {meta.fields.map((f) => (
        <div key={String(f.key)} className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t(f.labelKey)}
          </label>
          <input
            type={f.password ? "password" : "text"}
            value={(form[f.key] as string) ?? ""}
            onChange={(e) => update(f.key, e.target.value)}
            placeholder={f.placeholder}
            className={`${inputCls} font-mono`}
          />
        </div>
      ))}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() =>
            onSave({
              ...form,
              id: form.id ?? generateId(),
            } as NotificationChannel)
          }
          disabled={!isValid()}
          className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
        >
          {t("save")}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={!isValid() || testState === "sending"}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors"
        >
          {testState === "sending" && (
            <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {testState === "ok" && (
            <CheckCircle2 size={12} className="text-success" />
          )}
          {testState === "error" && (
            <AlertCircle size={12} className="text-destructive" />
          )}
          {t("test")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

// ─── Channel row ──────────────────────────────────────────────────────────────

function ChannelRow({
  channel,
  onToggle,
  onEdit,
  onDelete,
}: {
  channel: NotificationChannel;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("notification");
  const meta = CHANNEL_META[channel.type];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {channel.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {meta?.label ?? channel.type}
        </p>
      </div>
      <PillSwitch enabled={channel.enabled} onToggle={onToggle} />
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground border border-border hover:bg-accent transition-colors"
      >
        {t("edit")}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ─── Event keys ───────────────────────────────────────────────────────────────

const EVENT_KEYS: (keyof NotificationEvents)[] = [
  "training_complete",
  "training_failed",
  "export_complete",
  "export_failed",
  "dataset_complete",
  "dataset_failed",
];

function formatHistoryTime(value: string) {
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

// ─── Embeddable settings section ──────────────────────────────────────────────

export function NotificationSettings() {
  const { t } = useTranslation("notification");
  const {
    config,
    save,
    history,
    unreadCount,
    permission,
    lastNativeError,
    requestNativePermission,
    markHistoryRead,
    markAllHistoryRead,
    clearHistory,
  } = useNotificationStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);

  const toggleEvent = (key: keyof NotificationEvents) =>
    save({
      ...config,
      events: { ...config.events, [key]: !config.events[key] },
    });

  const saveChannel = (ch: NotificationChannel) => {
    const channels = config.channels.find((c) => c.id === ch.id)
      ? config.channels.map((c) => (c.id === ch.id ? ch : c))
      : [...config.channels, ch];
    save({ ...config, channels });
    setEditingId(null);
    setAddingNew(false);
  };

  const deleteChannel = (id: string) =>
    save({ ...config, channels: config.channels.filter((c) => c.id !== id) });

  const toggleChannel = (id: string) =>
    save({
      ...config,
      channels: config.channels.map((c) =>
        c.id === id ? { ...c, enabled: !c.enabled } : c,
      ),
    });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("sectionNative")}
        </p>
        <div className="rounded-lg border border-border divide-y divide-border">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <BellRing size={16} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  {t("nativePermission")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    `nativePermission_${permission === "unsupported" ? "unsupported" : permission}`,
                  )}
                </p>
              </div>
            </div>
            {permission !== "granted" && permission !== "unsupported" && (
              <button
                type="button"
                onClick={async () => {
                  setRequestingPermission(true);
                  try {
                    await requestNativePermission();
                  } finally {
                    setRequestingPermission(false);
                  }
                }}
                disabled={requestingPermission}
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors"
              >
                {requestingPermission ? t("requesting") : t("nativeEnable")}
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <Volume2 size={16} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm text-foreground">{t("nativeSound")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("nativeSoundHint")}
                </p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-medium text-foreground">
              {DEFAULT_NATIVE_NOTIFICATION_SOUND}
            </span>
          </div>
        </div>
        {lastNativeError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            {t("nativeError", { error: lastNativeError })}
          </div>
        )}
      </div>

      {/* ── Events ── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("sectionEvents")}
        </p>
        <div className="rounded-lg border border-border divide-y divide-border">
          {EVENT_KEYS.map((key) => (
            <div
              key={key}
              className="flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm text-foreground">
                {t(`event_${key}`)}
              </span>
              <PillSwitch
                enabled={config.events[key]}
                onToggle={() => toggleEvent(key)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Channels ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("sectionChannels")}
          </p>
          {!addingNew && (
            <button
              type="button"
              onClick={() => {
                setAddingNew(true);
                setEditingId(null);
              }}
              className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus size={12} />
              {t("addChannel")}
            </button>
          )}
        </div>

        {addingNew && (
          <ChannelForm
            channel={{}}
            onSave={saveChannel}
            onCancel={() => setAddingNew(false)}
          />
        )}

        {config.channels.length === 0 && !addingNew && (
          <button
            type="button"
            onClick={() => {
              setAddingNew(true);
              setEditingId(null);
            }}
            className="w-full rounded-lg border border-dashed border-border bg-card/30 px-4 py-8 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
          >
            {t("noChannels")}
          </button>
        )}

        <div className="space-y-2">
          {config.channels.map((ch) =>
            editingId === ch.id ? (
              <ChannelForm
                key={ch.id}
                channel={ch}
                onSave={saveChannel}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <ChannelRow
                key={ch.id}
                channel={ch}
                onToggle={() => toggleChannel(ch.id)}
                onEdit={() => {
                  setEditingId(ch.id);
                  setAddingNew(false);
                }}
                onDelete={() => deleteChannel(ch.id)}
              />
            ),
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("sectionHistory")}
          </p>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllHistoryRead()}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                {t("markAllRead")}
              </button>
            )}
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => clearHistory()}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                {t("clearHistory")}
              </button>
            )}
          </div>
        </div>

        {history.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-card/30 px-4 py-5 text-xs text-muted-foreground">
            <History size={14} className="shrink-0" />
            <span>{t("historyEmpty")}</span>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border px-4 py-3 ${
                  item.read_at
                    ? "border-border"
                    : "border-primary/30 bg-primary/5"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {!item.read_at && (
                        <span className="h-2 w-2 rounded-full bg-primary" />
                      )}
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.title}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(`event_${item.event_key}`, {
                        defaultValue: item.event_key,
                      })}{" "}
                      · {formatHistoryTime(item.created_at)}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground/90">
                      {item.body}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded-full border border-border px-2 py-0.5">
                        {item.native_delivered
                          ? t("historyDelivered")
                          : t("historyOnlyInbox")}
                      </span>
                      {item.sound && (
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {t("historySound", { sound: item.sound })}
                        </span>
                      )}
                    </div>
                  </div>
                  {!item.read_at && (
                    <button
                      type="button"
                      onClick={() => markHistoryRead(item.id)}
                      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                    >
                      {t("markRead")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground/60">{t("footerHint")}</p>
    </div>
  );
}
