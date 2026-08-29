import { Button, Dialog, SelectField, TextField } from "@translunar/ui";

import {
  EDITOR_SIZE_CHOICES,
  UI_FONT_PRESETS,
  UI_SIZE_CHOICES,
  useTypography,
} from "../lib/typography.js";
import { AiProviderSettings } from "./AiProviderSettings.js";
import { ShortcutsList } from "./ShortcutsDialog.js";
import { ThemePicker } from "./ThemePicker.js";

/**
 * The application settings center: one dialog, one section rail, every
 * application-level preference in a named place (Nielsen: recognition —
 * a reader looks for "settings", not for which panel a form hides in).
 * Project-scoped settings stay in ProjectSettingsDialog; nothing here
 * belongs to a particular project.
 */

export type SettingsSection = "appearance" | "typography" | "ai" | "shortcuts";

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "appearance", label: "外观" },
  { id: "typography", label: "字体" },
  { id: "ai", label: "AI 供应商" },
  { id: "shortcuts", label: "快捷键" },
];

const SECTION_TITLES: Record<SettingsSection, string> = {
  appearance: "外观",
  typography: "字体",
  ai: "AI 供应商",
  shortcuts: "键盘快捷键",
};

function TypographySettingsSection() {
  const {
    uiFont,
    uiSize,
    editorFont,
    editorSize,
    setTypography,
    resetTypography,
  } = useTypography();
  const hasOverride =
    uiFont !== null ||
    uiSize !== null ||
    editorFont !== null ||
    editorSize !== null;
  return (
    <div className="form-stack">
      <p className="settings-section__note">
        默认跟随主题的字体与字号；这里的选择立即生效并覆盖所有主题。Windows
        端小字号中文渲染易发虚，默认字号已按此调校。
      </p>
      <TextField
        label="界面字体"
        value={uiFont ?? ""}
        onChange={(event) =>
          setTypography({ uiFont: event.target.value || null })
        }
        placeholder="跟随主题"
        list="ui-font-presets"
        hint="可从建议中选择或输入本机字体名；清空恢复主题默认"
      />
      <datalist id="ui-font-presets">
        {UI_FONT_PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </datalist>
      <SelectField
        label="界面字号"
        value={uiSize === null ? "" : String(uiSize)}
        onChange={(event) =>
          setTypography({
            uiSize: event.target.value ? Number(event.target.value) : null,
          })
        }
        hint="正文字号；标题与辅助文字按层级自动缩放"
      >
        <option value="">跟随主题</option>
        {UI_SIZE_CHOICES.map((size) => (
          <option key={size} value={size}>
            {size}px
          </option>
        ))}
      </SelectField>
      <TextField
        label="编辑区字体"
        value={editorFont ?? ""}
        onChange={(event) =>
          setTypography({ editorFont: event.target.value || null })
        }
        placeholder="跟随界面字体"
        list="ui-font-presets"
        hint="仅作用于句段网格（源文/译文）"
      />
      <SelectField
        label="编辑区字号"
        value={editorSize === null ? "" : String(editorSize)}
        onChange={(event) =>
          setTypography({
            editorSize: event.target.value ? Number(event.target.value) : null,
          })
        }
        hint="仅作用于句段网格（源文/译文）"
      >
        <option value="">跟随界面字号</option>
        {EDITOR_SIZE_CHOICES.map((size) => (
          <option key={size} value={size}>
            {size}px
          </option>
        ))}
      </SelectField>
      {hasOverride ? (
        <div>
          <Button variant="outline" size="sm" onClick={resetTypography}>
            恢复默认字体设置
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface SettingsDialogProps {
  open: boolean;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onStatusMessage: (message: string) => void;
}

export function SettingsDialog({
  open,
  section,
  onSectionChange,
  onClose,
  onStatusMessage,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} title="设置" onClose={onClose} wide>
      <div className="settings-dialog">
        <nav className="settings-dialog__rail" aria-label="设置分区">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="settings-dialog__rail-item"
              data-active={entry.id === section || undefined}
              aria-current={entry.id === section ? "true" : undefined}
              onClick={() => onSectionChange(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="settings-dialog__content">
          <h3 className="settings-dialog__title">{SECTION_TITLES[section]}</h3>
          {section === "appearance" ? <ThemePicker /> : null}
          {section === "typography" ? <TypographySettingsSection /> : null}
          {section === "ai" ? (
            <AiProviderSettings onStatusMessage={onStatusMessage} />
          ) : null}
          {section === "shortcuts" ? <ShortcutsList /> : null}
        </div>
      </div>
    </Dialog>
  );
}
