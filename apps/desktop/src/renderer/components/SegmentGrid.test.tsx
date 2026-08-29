import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Segment } from "@translunar/contracts";

import { SegmentGrid } from "./SegmentGrid.js";
import type { SegmentGridHandle } from "./SegmentGrid.js";

function segment(
  id: string,
  ordinal: number,
  source: string,
  target = "",
): Segment {
  return {
    id,
    documentId: "d1",
    ordinal,
    structuralPath: `p:${ordinal}`,
    sourceText: source,
    targetText: target,
    state: target ? "draft" : "untranslated",
    revision: 1,
    sourceHash: "hash",
    contextHash: "context",
    updatedAtMs: 1,
  };
}

/**
 * Records the target editor's value once per React commit, from a layout
 * effect — i.e. before the browser would paint that commit. Any value
 * captured here is a value the user could see flash on screen.
 */
function EditorPaintProbe({ log }: { log: string[] }) {
  useLayoutEffect(() => {
    const editor = document.querySelector<HTMLTextAreaElement>(
      ".segment-grid__target-editor textarea",
    );
    if (editor) {
      log.push(editor.value);
    }
  });
  return null;
}

describe("SegmentGrid", () => {
  it("renders rows and selects a segment on click", async () => {
    const onSelect = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello."), segment("s2", 1, "World.")]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={onSelect}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Hello.")).toBeInTheDocument();
    await userEvent.click(screen.getByText("World."));
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("edits the active segment and confirms the typed draft with Ctrl+Enter", async () => {
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    await userEvent.type(editor, "你好。");
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [confirmedSegment, draft] = onConfirm.mock.calls[0] as [
      Segment,
      string,
    ];
    expect(confirmedSegment.id).toBe("s1");
    expect(draft).toBe("你好。");
  });

  it("never paints the previous segment's text when the selection moves (flash regression)", () => {
    // Bug report: segment 48 holds "240"; clicking the empty segment 66
    // flashed "240" inside 66's editor for one frame before it cleared.
    const paints: string[] = [];
    const rows = [segment("s48", 47, "测温", "240"), segment("s66", 65, "色板")];
    const shared = {
      segments: rows,
      qaSegmentIds: new Set<string>(),
      onSelect: vi.fn(),
      onSaveDraft: vi.fn(),
      onConfirm: vi.fn(),
    };
    const { rerender } = render(
      <>
        <SegmentGrid {...shared} activeSegmentId="s48" />
        <EditorPaintProbe log={paints} />
      </>,
    );
    expect(paints.at(-1)).toBe("240");
    const before = paints.length;
    rerender(
      <>
        <SegmentGrid {...shared} activeSegmentId="s66" />
        <EditorPaintProbe log={paints} />
      </>,
    );
    const afterSwitch = paints.slice(before);
    // Every value committed after the switch belongs to segment 66: the
    // editor must never hold "240" at any paintable moment.
    expect(afterSwitch.length).toBeGreaterThan(0);
    expect(afterSwitch).not.toContain("240");
    expect(afterSwitch.at(-1)).toBe("");
  });

  it("edits the source on double-click and commits with Ctrl+Enter", async () => {
    const onUpdateSource = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Helo world.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
        onUpdateSource={onUpdateSource}
      />,
    );
    await userEvent.dblClick(screen.getByText("Helo world."));
    const editor = screen.getByLabelText("句段 1 源文");
    expect(editor).toHaveValue("Helo world.");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Hello world.");
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onUpdateSource).toHaveBeenCalledTimes(1);
    const [edited, text] = onUpdateSource.mock.calls[0] as [Segment, string];
    expect(edited.id).toBe("s1");
    expect(text).toBe("Hello world.");
    // The editor closed and the cell shows the (still-propped) source text.
    expect(screen.queryByLabelText("句段 1 源文")).not.toBeInTheDocument();
  });

  it("cancels a source edit with Escape without writing", async () => {
    const onUpdateSource = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
        onUpdateSource={onUpdateSource}
      />,
    );
    await userEvent.dblClick(screen.getByText("Hello."));
    const editor = screen.getByLabelText("句段 1 源文");
    await userEvent.type(editor, " typed");
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onUpdateSource).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("句段 1 源文")).not.toBeInTheDocument();
  });

  it("never opens the source editor on a locked row", async () => {
    const locked = { ...segment("s1", 0, "Hello.", "你好。"), locked: true };
    render(
      <SegmentGrid
        segments={[locked]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
        onUpdateSource={vi.fn()}
      />,
    );
    await userEvent.dblClick(screen.getByText("Hello."));
    expect(screen.queryByLabelText("句段 1 源文")).not.toBeInTheDocument();
  });

  it("renders no per-row save/confirm buttons in the active row", () => {
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // Trados-style editor: typing auto-saves the draft and Ctrl+Enter (or
    // the ribbon/menu) confirms — the row itself carries no buttons.
    expect(
      screen.queryByRole("button", { name: "保存草稿" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "确认" }),
    ).not.toBeInTheDocument();
  });

  it("flags segments with open QA issues on the status chip", () => {
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "30 days.", "60 天。")]}
        activeSegmentId={null}
        qaSegmentIds={new Set(["s1"])}
        qaCounts={new Map([["s1", 2]])}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // The chip is one combined glyph unit: state glyph + ⚠n QA overlay,
    // with the full story in the accessible name (never color-only).
    const chip = screen.getByRole("img", {
      name: "草稿，2 个未解决 QA 问题",
    });
    expect(chip).toHaveTextContent("⚠2");
  });

  it("reports the state through the chip's accessible name", () => {
    render(
      <SegmentGrid
        segments={[
          segment("s1", 0, "Hello."),
          segment("s2", 1, "World.", "世界。"),
        ]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "未译" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "草稿" })).toBeInTheDocument();
  });

  it("renders persisted origin chips honestly (S2a)", () => {
    const withOrigin = (
      base: Segment,
      origin: NonNullable<Segment["origin"]>,
    ): Segment => ({ ...base, origin });
    const { container } = render(
      <SegmentGrid
        segments={[
          // TM fuzzy apply: score + TM label, fuzzy (accent) tone.
          withOrigin(segment("s1", 0, "One.", "一。"), {
            kind: "tmFuzzy",
            score: 85,
            edited: false,
          }),
          // Edited after apply: the value stays, the tone fill goes.
          withOrigin(segment("s2", 1, "Two.", "二！"), {
            kind: "tmExact",
            score: 100,
            edited: true,
          }),
          // AI draft: label only — no provider returns confidence, so the
          // chip never carries a number.
          withOrigin(segment("s3", 2, "Three.", "三。"), {
            kind: "aiDraft",
            model: "gpt-test",
            edited: false,
          }),
          // History/human rows have no origin: the chip slot stays empty.
          segment("s4", 3, "Four.", "四。"),
        ]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const chips = container.querySelectorAll(".tl-match");
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent("85TM");
    expect(chips[0]).toHaveAttribute("data-tone", "accent");
    // Tooltip: 状态/来源/分值/模型 — only the lines that exist.
    expect(chips[0]).toHaveAttribute(
      "title",
      "状态：草稿\n来源：TM 模糊\n分值：85",
    );
    expect(chips[1]).toHaveTextContent("100TM");
    expect(chips[1]).not.toHaveAttribute("data-tone");
    expect(chips[1]).toHaveAttribute("data-muted");
    expect(chips[2]).toHaveTextContent("AI");
    expect(chips[2]?.querySelector(".tl-match__score")).toBeNull();
    expect(chips[2]).toHaveAttribute(
      "title",
      "状态：草稿\n来源：AI\n模型：gpt-test",
    );
  });

  it("shows the live lookup badge only on origin-less active rows", () => {
    const match = {
      entry: {
        id: "tm1",
        memoryId: "m1",
        sourceText: "One.",
        targetText: "一。",
        sourceHash: "hash",
        originProjectId: "p1",
        originDocumentId: "d1",
        originSegmentId: "s0",
        confirmedAtMs: 1,
      },
      score: 92,
      grade: "fuzzy" as const,
    };
    // Origin-less active row: the live lookup badge is the only honest
    // score available.
    const { container, rerender } = render(
      <SegmentGrid
        segments={[segment("s1", 0, "One.", "一。")]}
        activeSegmentId="s1"
        activeMatch={match}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTitle("TM 最佳匹配 92%")).toBeInTheDocument();

    // Once a real stored origin exists it wins over the live lookup.
    rerender(
      <SegmentGrid
        segments={[
          {
            ...segment("s1", 0, "One.", "一。"),
            origin: { kind: "tmExact", score: 100, edited: false },
          },
        ]}
        activeSegmentId="s1"
        activeMatch={match}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByTitle("TM 最佳匹配 92%")).not.toBeInTheDocument();
    expect(container.querySelector(".tl-match")).toHaveAttribute(
      "title",
      "状态：草稿\n来源：TM 精确\n分值：100",
    );
  });

  it("reports the caret line/column while editing and clears it on exit", () => {
    const onCaretChange = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "第一行\n第二行")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
        onCaretChange={onCaretChange}
      />,
    );
    const editor = screen.getByLabelText<HTMLTextAreaElement>("句段 1 译文");
    // Mount report: the caret starts at the top of the editor.
    expect(onCaretChange).toHaveBeenCalledWith({ line: 1, column: 1 });

    // Moving the caret past the newline reports the real line/column.
    editor.setSelectionRange(5, 5);
    fireEvent.select(editor);
    expect(onCaretChange).toHaveBeenLastCalledWith({ line: 2, column: 2 });

    // Esc leaves editing: the readout clears instead of freezing stale.
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onCaretChange).toHaveBeenLastCalledWith(null);
  });

  it("renders every row for small documents (no virtualization)", () => {
    const segments = Array.from({ length: 20 }, (_, i) =>
      segment(`s${i}`, i, `Sentence ${i}.`),
    );
    const { container } = render(
      <SegmentGrid
        segments={segments}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(20);
    expect(container.querySelector(".segment-grid__spacer")).toBeNull();
  });

  it("inserts text at the editor caret through the imperative handle", () => {
    const gridRef = createRef<SegmentGridHandle>();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "The retention period.", "保留是 30 天。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText<HTMLTextAreaElement>("句段 1 译文");
    editor.setSelectionRange(2, 2);
    let inserted = false;
    act(() => {
      inserted = gridRef.current!.insertAtCaret("期");
    });
    expect(inserted).toBe(true);
    expect(editor.value).toBe("保留期是 30 天。");
    // Caret lands right after the inserted text and focus returns to the
    // editor so the confirm shortcut keeps working.
    expect(editor.selectionStart).toBe(3);
    expect(editor.selectionEnd).toBe(3);
    expect(document.activeElement).toBe(editor);
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[1]).toBe("保留期是 30 天。");
  });

  it("replaces the selected range when inserting", () => {
    const gridRef = createRef<SegmentGridHandle>();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "The retention period.", "错误术语在此。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const editor = screen.getByLabelText<HTMLTextAreaElement>("句段 1 译文");
    editor.setSelectionRange(0, 4);
    act(() => {
      gridRef.current!.insertAtCaret("保留期");
    });
    expect(editor.value).toBe("保留期在此。");
    expect(editor.selectionStart).toBe(3);
    expect(editor.selectionEnd).toBe(3);
  });

  it("defers inserts during IME composition until the composition ends", () => {
    const gridRef = createRef<SegmentGridHandle>();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "The retention period.", "初稿")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const editor = screen.getByLabelText<HTMLTextAreaElement>("句段 1 译文");
    editor.setSelectionRange(2, 2);
    fireEvent.compositionStart(editor);
    let inserted = false;
    act(() => {
      inserted = gridRef.current!.insertAtCaret("术语");
    });
    expect(inserted).toBe(true);
    // Mid-composition the value stays untouched so the IME is not broken.
    expect(editor.value).toBe("初稿");
    fireEvent.compositionEnd(editor);
    expect(editor.value).toBe("初稿术语");
    expect(editor.selectionStart).toBe(4);
  });

  it("reports no editor when no row is being edited", () => {
    const gridRef = createRef<SegmentGridHandle>();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(gridRef.current!.insertAtCaret("术语")).toBe(false);
  });

  it("confirms the live draft through the imperative handle (menu path)", async () => {
    const gridRef = createRef<SegmentGridHandle>();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "Hello.", "你好")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    // Extend the draft first: the handle must confirm the unsaved editor
    // text, exactly like the Ctrl+Enter chord.
    await userEvent.type(screen.getByLabelText("句段 1 译文"), "。");
    let confirmed = false;
    act(() => {
      confirmed = gridRef.current!.confirmActive();
    });
    expect(confirmed).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [confirmedSegment, draft] = onConfirm.mock.calls[0] as [
      Segment,
      string,
    ];
    expect(confirmedSegment.id).toBe("s1");
    expect(draft).toBe("你好。");
  });

  it("refuses to confirm through the handle when no editor is mounted", () => {
    const gridRef = createRef<SegmentGridHandle>();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(gridRef.current!.confirmActive()).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("refuses to confirm through the handle during IME composition", () => {
    const gridRef = createRef<SegmentGridHandle>();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.compositionStart(editor);
    expect(gridRef.current!.confirmActive()).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor);
    let confirmed = false;
    act(() => {
      confirmed = gridRef.current!.confirmActive();
    });
    expect(confirmed).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores the confirm shortcut while an IME composition is active", () => {
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.keyDown(editor, {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("auto-saves the typed draft after a pause, without any button", async () => {
    const onSaveDraft = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    await userEvent.type(editor, "你好。");
    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
    const [savedSegment, text] = onSaveDraft.mock.calls[0] as [Segment, string];
    expect(savedSegment.id).toBe("s1");
    expect(text).toBe("你好。");
  });

  it("flushes unsaved typing when the selection leaves the segment, and never confirms", () => {
    const onSaveDraft = vi.fn();
    const onConfirm = vi.fn();
    const segments = [segment("s1", 0, "Hello."), segment("s2", 1, "World.")];
    const view = render(
      <SegmentGrid
        segments={segments}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={onConfirm}
        autoSaveDelayMs={60_000}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.change(editor, { target: { value: "你好。" } });
    // Selection moves before the debounce ever fires: the text still lands
    // as a draft of the segment it was typed into (Studio semantics), and
    // leaving a segment never confirms it.
    view.rerender(
      <SegmentGrid
        segments={segments}
        activeSegmentId="s2"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={onConfirm}
        autoSaveDelayMs={60_000}
      />,
    );
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    const [savedSegment, text] = onSaveDraft.mock.calls[0] as [Segment, string];
    expect(savedSegment.id).toBe("s1");
    expect(text).toBe("你好。");
    expect(onConfirm).not.toHaveBeenCalled();
    // The editor re-seeded for s2 (empty target).
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("句段 2 译文").value,
    ).toBe("");
  });

  it("saves nothing when the editor text matches the committed target", () => {
    const onSaveDraft = vi.fn();
    const { unmount } = render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    unmount();
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("holds the auto-save during IME composition and saves after compositionend", async () => {
    const onSaveDraft = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: "你好" } });
    // Composition text stays out of segment.update while the IME is open.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onSaveDraft).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor);
    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
    expect(onSaveDraft.mock.calls[0]?.[1]).toBe("你好");
  });

  it("confirm hands the text off and cancels the pending auto-save", async () => {
    const onSaveDraft = vi.fn();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={onConfirm}
        autoSaveDelayMs={20}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.change(editor, { target: { value: "你好。" } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[1]).toBe("你好。");
    // The confirm persists the text itself; the debounced draft save must
    // not fire a duplicate write afterwards.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  it("never confirms on Esc or blur", async () => {
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    await userEvent.type(editor, "你好。");
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.blur(editor);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("retries the same text on the next flush when the save was never acked", async () => {
    // onSaveDraft resolving false = the engine never acked the write.
    const onSaveDraft = vi.fn().mockResolvedValue(false);
    const segments = [segment("s1", 0, "Hello.")];
    const view = render(
      <SegmentGrid
        segments={segments}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.change(editor, { target: { value: "你好。" } });
    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
    // Leaving the segment flushes the unacked text again instead of
    // silently treating the failed write as saved.
    view.rerender(
      <SegmentGrid
        segments={segments}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={20}
      />,
    );
    expect(onSaveDraft).toHaveBeenCalledTimes(2);
    expect(onSaveDraft.mock.calls[1]?.[1]).toBe("你好。");
  });

  it("maps the Studio chord family onto confirm modes", () => {
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true, altKey: true });
    fireEvent.keyDown(editor, {
      key: "Enter",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });
    expect(onConfirm.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      "nextUnconfirmed",
      "nextAny",
      "stay",
    ]);
  });

  it("maps Ctrl+Shift+Enter to the confirm-without-TM mode", () => {
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("句段 1 译文"), {
      key: "Enter",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![2]).toBe("nextUnconfirmedSkipTm");
  });

  it("confirms with an explicit mode through the imperative handle", () => {
    const gridRef = createRef<SegmentGridHandle>();
    const onConfirm = vi.fn();
    render(
      <SegmentGrid
        ref={gridRef}
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    act(() => {
      gridRef.current!.confirmActive("stay");
    });
    expect(onConfirm.mock.calls[0]?.[2]).toBe("stay");
  });

  it("highlights placeholder tokens in source and non-editing target", () => {
    const { container } = render(
      <SegmentGrid
        segments={[
          segment("s1", 0, "Hi {name}, see <b>docs</b>.", "见 <b>文档</b>。"),
        ]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const tokens = [...container.querySelectorAll(".tl-token")].map(
      (node) => node.textContent,
    );
    // Source: {name}, <b>, </b>; target: <b>, </b> — same lexer both sides.
    expect(tokens).toEqual(["{name}", "<b>", "</b>", "<b>", "</b>"]);
  });

  it("marks QA-flagged tokens with the danger outline, driven by evidence", () => {
    const { container } = render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hi {name} and {other}.", "你好 {nmae}。")]}
        activeSegmentId={null}
        qaSegmentIds={new Set(["s1"])}
        placeholderAlerts={
          new Map([
            [
              "s1",
              {
                missing: new Set(["{name}", "{other}"]),
                extra: new Set(["{nmae}"]),
              },
            ],
          ])
        }
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const danger = [...container.querySelectorAll(".tl-token[data-danger]")]
      .map((node) => node.textContent)
      .sort();
    expect(danger).toEqual(["{name}", "{nmae}", "{other}"]);
  });

  it("exits editing on Esc (keeping the draft) and re-enters on Enter", () => {
    const onSaveDraft = vi.fn();
    const { container } = render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={60_000}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.change(editor, { target: { value: "草稿文字" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    // Esc never confirms and never drops typing: the text flushed as a
    // draft, the editor unmounted, and focus moved to the row.
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(onSaveDraft.mock.calls[0]?.[1]).toBe("草稿文字");
    expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();
    const row = container.querySelector('tr[data-segment-id="s1"]');
    expect(document.activeElement).toBe(row);
    // Enter re-enters editing on the selected row.
    fireEvent.keyDown(row!, { key: "Enter" });
    expect(screen.getByLabelText("句段 1 译文")).toBeInTheDocument();
  });

  it("ignores Esc inside the editor during IME composition", () => {
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    fireEvent.keyDown(editor, { key: "Escape", isComposing: true });
    // Cancelling the IME composition must not tear down the editor.
    expect(screen.getByLabelText("句段 1 译文")).toBeInTheDocument();
  });

  it("moves the selection with arrow keys in row-navigation mode", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello."), segment("s2", 1, "World.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={onSelect}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // Leave editing so the rows own the arrow keys.
    fireEvent.keyDown(screen.getByLabelText("句段 1 译文"), { key: "Escape" });
    const row = container.querySelector('tr[data-segment-id="s1"]')!;
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("gives only the active row a tab stop (roving tabIndex)", () => {
    const { container } = render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello."), segment("s2", 1, "World.")]}
        activeSegmentId="s2"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(container.querySelector('tr[data-segment-id="s2"]')).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(container.querySelector('tr[data-segment-id="s1"]')).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("offers 复制源文 and 清空译文 in the row menu", async () => {
    const onCopySource = vi.fn();
    const onClearTarget = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
        onCopySource={onCopySource}
        onClearTarget={onClearTarget}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "句段 1 菜单" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "复制源文" }));
    expect(onCopySource).toHaveBeenCalledTimes(1);
    expect((onCopySource.mock.calls[0]?.[0] as Segment).id).toBe("s1");
    // The menu offers no confirm action — confirming is a keyboard act.
    await userEvent.click(screen.getByRole("button", { name: "句段 1 菜单" }));
    expect(
      screen.queryByRole("menuitem", { name: /确认/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "清空译文" }));
    expect(onClearTarget).toHaveBeenCalledTimes(1);
  });

  it("disables 清空译文 when the target is already empty", async () => {
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.")]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
        onCopySource={vi.fn()}
        onClearTarget={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "句段 1 菜单" }));
    expect(screen.getByRole("menuitem", { name: "清空译文" })).toBeDisabled();
  });

  it("opens the row menu from a right-click and selects the row", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello."), segment("s2", 1, "World.")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={onSelect}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
        onCopySource={vi.fn()}
        onClearTarget={vi.fn()}
      />,
    );
    fireEvent.contextMenu(container.querySelector('tr[data-segment-id="s2"]')!);
    expect(onSelect).toHaveBeenCalledWith("s2");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("locked rows show the lock glyph and never mount the editor", () => {
    const { container } = render(
      <SegmentGrid
        segments={[
          { ...segment("s1", 0, "Hello.", "你好。"), locked: true },
          segment("s2", 1, "World."),
        ]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // The lock is its own glyph with an accessible name — never a recolor
    // of the state chip — and the row carries data-locked for styling.
    expect(
      screen.getByRole("img", { name: "句段 1 已锁定" }),
    ).toBeInTheDocument();
    const row = container.querySelector('tr[data-segment-id="s1"]')!;
    expect(row).toHaveAttribute("data-locked", "true");
    // Selection is allowed (read-only pivot) but the editor never mounts:
    // the saved target renders as plain text and Enter stays a no-op.
    expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();
    expect(screen.getByText("你好。")).toBeInTheDocument();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.queryByLabelText("句段 1 译文")).not.toBeInTheDocument();
    // The unlocked row is unaffected by its sibling's lock.
    expect(
      container.querySelector('tr[data-segment-id="s2"]'),
    ).not.toHaveAttribute("data-locked");
  });

  it("row menu on a locked row offers 解锁 and disables the write actions", async () => {
    const onToggleLock = vi.fn();
    render(
      <SegmentGrid
        segments={[{ ...segment("s1", 0, "Hello.", "你好。"), locked: true }]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
        onCopySource={vi.fn()}
        onClearTarget={vi.fn()}
        onToggleLock={onToggleLock}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "句段 1 菜单" }));
    // Both write actions would conflict against the engine's lock guard,
    // so they disable instead of pretending.
    expect(screen.getByRole("menuitem", { name: "复制源文" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "清空译文" })).toBeDisabled();
    await userEvent.click(screen.getByRole("menuitem", { name: "解锁" }));
    expect(onToggleLock).toHaveBeenCalledTimes(1);
    expect((onToggleLock.mock.calls[0]?.[0] as Segment).id).toBe("s1");
  });

  it("row menu on an unlocked row offers 锁定", async () => {
    const onToggleLock = vi.fn();
    render(
      <SegmentGrid
        segments={[segment("s1", 0, "Hello.", "你好。")]}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
        onToggleLock={onToggleLock}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "句段 1 菜单" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "锁定" }));
    expect(onToggleLock).toHaveBeenCalledTimes(1);
  });

  it("flushDraft persists pending typing without waiting for the debounce", async () => {
    const onSaveDraft = vi.fn();
    const ref = createRef<SegmentGridHandle>();
    render(
      <SegmentGrid
        ref={ref}
        segments={[segment("s1", 0, "Hello.", "旧文。")]}
        activeSegmentId="s1"
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={onSaveDraft}
        onConfirm={vi.fn()}
        autoSaveDelayMs={60_000}
      />,
    );
    const editor = screen.getByLabelText("句段 1 译文");
    await userEvent.clear(editor);
    await userEvent.type(editor, "新文。");
    // The debounce is armed far in the future; the imperative flush is the
    // pre-lock hand-off, so the typed text lands as a draft right now.
    expect(onSaveDraft).not.toHaveBeenCalled();
    act(() => {
      ref.current!.flushDraft();
    });
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(onSaveDraft.mock.calls[0]?.[1]).toBe("新文。");
  });

  it("windows large documents instead of rendering every row", () => {
    const segments = Array.from({ length: 500 }, (_, i) =>
      segment(`s${i}`, i, `Sentence ${i}.`),
    );
    const { container } = render(
      <SegmentGrid
        segments={segments}
        activeSegmentId={null}
        qaSegmentIds={new Set()}
        onSelect={vi.fn()}
        onSaveDraft={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const rows = container.querySelectorAll(
      "tbody tr:not(.segment-grid__spacer)",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    // The unrendered tail is held open by a spacer row.
    expect(
      container.querySelectorAll(".segment-grid__spacer").length,
    ).toBeGreaterThan(0);
    // First window starts at the top of the document.
    expect(screen.getByText("Sentence 0.")).toBeInTheDocument();
    expect(screen.queryByText("Sentence 499.")).not.toBeInTheDocument();
  });
});
