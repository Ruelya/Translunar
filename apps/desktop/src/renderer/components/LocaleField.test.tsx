import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { LocaleField } from "./LocaleField.js";

function Harness() {
  const [value, setValue] = useState("");
  return (
    <LocaleField
      label="源语言"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

describe("LocaleField", () => {
  it("offers searchable BCP-47 suggestions while keeping free entry", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("源语言");
    // Recognition over recall: the expected format shows before typing.
    expect(input).toHaveAttribute("placeholder", "如 en-US");
    expect(screen.getByText(/BCP-47 语言标签/)).toBeInTheDocument();
    // The input is wired to a datalist carrying tags with Chinese names.
    const listId = input.getAttribute("list");
    expect(listId).toBeTruthy();
    const list = document.getElementById(listId!);
    expect(list?.tagName).toBe("DATALIST");
    expect(list?.querySelector('option[value="zh-CN"]')).not.toBeNull();
    // Free entry: a tag outside the list is still accepted.
    await userEvent.type(input, "yue-HK");
    expect(input).toHaveValue("yue-HK");
  });
});
