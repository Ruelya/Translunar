import { Button, Dialog } from "@translunar/ui";

/**
 * 帮助 ▸ 键盘快捷键: the chords the product actually binds — the workbench
 * keymap (FEATURE-INVENTORY §8), the grid editor's confirm family, and the
 * menu-owned accelerators. Rows are [action label, keys]; anything absent
 * here is absent from the product.
 */
const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ["确认当前句段", "Ctrl+Enter"],
  ["确认并到下一句段", "Ctrl+Alt+Enter"],
  ["确认并停留", "Ctrl+Alt+Shift+Enter"],
  ["确认但跳过 TM 写入", "Ctrl+Shift+Enter"],
  ["锁定/解锁句段", "Ctrl+L"],
  ["上一句段 / 下一句段", "Alt+↑ / Alt+↓"],
  ["应用第 n 条记忆匹配（编辑器内）", "Ctrl+1…9"],
  ["切换面板（记忆/术语/QA/AI）", "Ctrl+1…4"],
  ["查找", "Ctrl+F"],
  ["替换", "Ctrl+H"],
  ["查找下一个 / 上一个", "F4 / Shift+F4"],
  ["筛选句段", "Ctrl+Shift+F"],
  ["转到句段", "Ctrl+G"],
  ["下一 QA 句段", "F8"],
  ["检索（取选中文本）", "F3"],
  ["命令面板", "Ctrl+K / Ctrl+Shift+P"],
  ["导入文档", "Ctrl+O"],
  ["导出译文", "Ctrl+E"],
  ["项目设置", "Ctrl+,"],
  ["预览面板", "Ctrl+P"],
  ["清除筛选", "Esc"],
];

/** The bare chord table — reused by the settings dialog's 快捷键 section. */
export function ShortcutsList() {
  return (
    <dl className="shortcuts">
      {SHORTCUTS.map(([label, keys]) => (
        <div key={label} className="shortcuts__row">
          <dt>{label}</dt>
          <dd>
            <kbd>{keys}</kbd>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Dialog
      title="键盘快捷键"
      open={open}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <ShortcutsList />
    </Dialog>
  );
}
