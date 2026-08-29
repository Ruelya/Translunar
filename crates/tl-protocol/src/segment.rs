//! Segment domain: the editing grid.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tl_domain::{QaIssue, Segment, SegmentOrigin, TmEntry};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentListParams {
    pub document_id: String,
    /// Rows to skip in ordinal order; defaults to 0.
    #[serde(default)]
    pub offset: Option<u32>,
    /// Page size. When omitted the whole document is returned, which is the
    /// pre-paging behavior existing clients rely on.
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentListResult {
    pub segments: Vec<Segment>,
    /// Segments in the document before the page window was applied, so
    /// clients can size scrollbars without fetching every row.
    pub total_segments: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentUpdateParams {
    pub segment_id: String,
    pub target_text: String,
    /// Optimistic concurrency: must match the segment's current revision.
    pub base_revision: u64,
    /// Where `targetText` came from, for writes that apply stored material
    /// (TM match apply → `tmExact`/`tmFuzzy` with the real lookup score, AI
    /// draft apply → `aiDraft` with the provider model). The kinds are the
    /// closed [`SegmentOrigin`] enum — nothing free-form. Omit for human
    /// typing: the engine then keeps any existing origin and marks it
    /// `edited` when the target changed, and clears the origin entirely
    /// when the update empties the target. `origin.edited` is engine-owned
    /// and ignored on input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<SegmentOrigin>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentUpdateResult {
    pub segment: Segment,
}

/// Parameters for `segment.updateSource`: rewrite the source text of one
/// segment (imported text carrying an OCR error or a typo the translator
/// must fix in place). Guards mirror `segment.update`: a stale
/// `baseRevision` conflicts and a locked segment conflicts. The source
/// must not become empty — a segment without source text has no meaning.
/// Rewriting the source of a confirmed segment honestly returns it to
/// `draft`: the confirmation covered the old source. Any TM entry written
/// by an earlier confirm is left as it was (mirroring `segment.replace`),
/// and the stored target-origin stamp is kept — it still describes where
/// the target text came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentUpdateSourceParams {
    pub segment_id: String,
    pub source_text: String,
    /// Optimistic concurrency: must match the segment's current revision.
    pub base_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentUpdateSourceResult {
    pub segment: Segment,
}

/// Parameters for `segment.replace`: one document-wide search-and-replace
/// over target text. Matching is case-insensitive with per-character
/// Unicode lowercase folding — the same semantics as the grid find box —
/// and occurrences never overlap. Source text is never touched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentReplaceParams {
    pub document_id: String,
    /// Text to find in target text. Must not be empty.
    pub find: String,
    /// Replacement text. May be empty, which deletes the found text; a
    /// target emptied this way honestly returns to `untranslated`.
    pub replace_with: String,
    /// Also rewrite confirmed segments. A rewritten confirmed segment moves
    /// back to `draft` — the confirmation covered the old text — and its TM
    /// entry is left as it was (replace drafts, it never confirms). Default
    /// false: confirmed matches are skipped and counted instead.
    #[serde(default)]
    pub include_confirmed: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentReplaceResult {
    /// Rewritten segments in grid order, carrying their new revision and
    /// state, so clients can apply them without a full reload.
    pub segments: Vec<Segment>,
    /// Total occurrences replaced across `segments`.
    pub replaced_occurrences: u32,
    /// How many of `segments` were confirmed before this replace moved them
    /// back to draft. Non-zero only with `includeConfirmed`.
    pub demoted_confirmed: u32,
    /// Matching confirmed segments left untouched because
    /// `includeConfirmed` was not set.
    pub skipped_confirmed: u32,
    /// Matching locked segments left untouched. Locked rows are never
    /// rewritten, even with `includeConfirmed`.
    #[serde(default)]
    pub skipped_locked: u32,
}

/// Parameters for `segment.lock`: set or clear a segment's lock. Locking is
/// idempotent — locking an already-locked row (or unlocking an unlocked one)
/// still bumps the revision and succeeds. `baseRevision` follows the same
/// optimistic-concurrency rule as `segment.update`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentLockParams {
    pub segment_id: String,
    pub locked: bool,
    pub base_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentLockResult {
    pub segment: Segment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentConfirmParams {
    pub segment_id: String,
    pub base_revision: u64,
    /// Confirm without touching translation memory: the segment still turns
    /// confirmed and confirm-time QA still runs, but no TM entry is written
    /// and no duplicate propagation happens — the pair spreads nowhere.
    /// Also the escape hatch when no writable memory is mounted. Defaults
    /// to false: the ordinary confirm keeps writing TM.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_tm_write: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentConfirmResult {
    pub segment: Segment,
    /// The translation-memory entry written by the confirmation; absent
    /// when the confirm skipped the TM write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tm_entry: Option<TmEntry>,
    /// Sibling segments auto-filled from the confirmed translation.
    pub propagated: Vec<Segment>,
    /// Confirm-time QA: every persisted issue of the confirmed segment
    /// after the engine re-ran the segment-scoped rules against the
    /// confirmed text, committed in the same transaction as the confirm.
    /// All statuses are included so clients can replace their records for
    /// this segment wholesale. Cross-segment consistency rules are not
    /// re-evaluated here — those refresh on the next `qa.run`.
    #[serde(default)]
    pub qa_issues: Vec<QaIssue>,
}
