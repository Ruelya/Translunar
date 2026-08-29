import { useId } from "react";

import { TextField } from "@translunar/ui";
import type { TextFieldProps } from "@translunar/ui";

/**
 * Language-tag input with a searchable suggestion list. A bare text input
 * asks the reader to recall the product's naming convention (en-US?
 * zh_CN? chinese?); this field shows BCP-47 tags with Chinese names and
 * filters as you type, while still accepting any tag the list lacks —
 * guidance, not a gate. The engine remains the validator of record.
 */

export interface LocaleOption {
  tag: string;
  label: string;
}

/** Common working locales, BCP-47, with zh-CN display names. */
export const COMMON_LOCALES: readonly LocaleOption[] = [
  { tag: "zh-CN", label: "中文（简体）" },
  { tag: "zh-TW", label: "中文（繁体，台湾）" },
  { tag: "zh-HK", label: "中文（繁体，香港）" },
  { tag: "en-US", label: "英语（美国）" },
  { tag: "en-GB", label: "英语（英国）" },
  { tag: "ja-JP", label: "日语" },
  { tag: "ko-KR", label: "韩语" },
  { tag: "de-DE", label: "德语" },
  { tag: "fr-FR", label: "法语" },
  { tag: "es-ES", label: "西班牙语（西班牙）" },
  { tag: "es-419", label: "西班牙语（拉美）" },
  { tag: "pt-BR", label: "葡萄牙语（巴西）" },
  { tag: "pt-PT", label: "葡萄牙语（葡萄牙）" },
  { tag: "it-IT", label: "意大利语" },
  { tag: "ru-RU", label: "俄语" },
  { tag: "uk-UA", label: "乌克兰语" },
  { tag: "pl-PL", label: "波兰语" },
  { tag: "cs-CZ", label: "捷克语" },
  { tag: "nl-NL", label: "荷兰语" },
  { tag: "sv-SE", label: "瑞典语" },
  { tag: "da-DK", label: "丹麦语" },
  { tag: "nb-NO", label: "挪威语（书面）" },
  { tag: "fi-FI", label: "芬兰语" },
  { tag: "tr-TR", label: "土耳其语" },
  { tag: "ar-SA", label: "阿拉伯语" },
  { tag: "he-IL", label: "希伯来语" },
  { tag: "hi-IN", label: "印地语" },
  { tag: "th-TH", label: "泰语" },
  { tag: "vi-VN", label: "越南语" },
  { tag: "id-ID", label: "印尼语" },
  { tag: "ms-MY", label: "马来语" },
  { tag: "el-GR", label: "希腊语" },
  { tag: "hu-HU", label: "匈牙利语" },
  { tag: "ro-RO", label: "罗马尼亚语" },
  { tag: "bg-BG", label: "保加利亚语" },
  { tag: "sk-SK", label: "斯洛伐克语" },
  { tag: "hr-HR", label: "克罗地亚语" },
  { tag: "sr-RS", label: "塞尔维亚语" },
  { tag: "lt-LT", label: "立陶宛语" },
  { tag: "lv-LV", label: "拉脱维亚语" },
  { tag: "et-EE", label: "爱沙尼亚语" },
  { tag: "sl-SI", label: "斯洛文尼亚语" },
  { tag: "fa-IR", label: "波斯语" },
  { tag: "bn-BD", label: "孟加拉语" },
  { tag: "ta-IN", label: "泰米尔语" },
  { tag: "ur-PK", label: "乌尔都语" },
  { tag: "km-KH", label: "高棉语" },
  { tag: "my-MM", label: "缅甸语" },
  { tag: "mn-MN", label: "蒙古语" },
  { tag: "kk-KZ", label: "哈萨克语" },
];

export type LocaleFieldProps = Omit<TextFieldProps, "list" | "hint"> & {
  /** Override the one-line hint under the control. */
  hint?: TextFieldProps["hint"];
};

export function LocaleField({ hint, ...rest }: LocaleFieldProps) {
  const listId = useId();
  return (
    <>
      <TextField
        {...rest}
        list={listId}
        placeholder={rest.placeholder ?? "如 en-US"}
        hint={hint ?? "BCP-47 语言标签；输入可搜索，也可直接填列表外的标签"}
      />
      <datalist id={listId}>
        {COMMON_LOCALES.map((locale) => (
          <option key={locale.tag} value={locale.tag}>
            {locale.label}
          </option>
        ))}
      </datalist>
    </>
  );
}
