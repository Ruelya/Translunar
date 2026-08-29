# Agent Skills

Portable agent skills available to any assistant working in this repository.

| Skill | Purpose |
| --- | --- |
| `design-taste-frontend` | Anti-slop frontend taste rules (layout, typography, motion, copy discipline). |
| `ui-ux-pro-max` | Searchable UI/UX rule database (styles, palettes, typography, UX guidelines, stack rules). |
| `translunar-cli` | Drive the Translunar engine from external agents through the `tl-cli` JSON-RPC bridge (projects, segments, TM/terms, QA, export, AI harness). |

---

## `design-taste-frontend` (taste-skill)

- Upstream: <https://github.com/Leonxlnx/taste-skill> (`skills/taste-skill/SKILL.md`)
- License: see `design-taste-frontend/LICENSE`
- Invocation: read `design-taste-frontend/SKILL.md` before UI structure, visual, or
  motion work.

## `ui-ux-pro-max`

- Upstream: <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>
  (`.claude/skills/ui-ux-pro-max/`)
- License: see `ui-ux-pro-max/LICENSE`
- Requires Python 3 (no third-party packages). Script paths in `SKILL.md` were
  rewritten to this repository's layout.

```bash
python3 ".agents/skills/ui-ux-pro-max/scripts/search.py" "<query>" --domain ux -n 5
python3 ".agents/skills/ui-ux-pro-max/scripts/search.py" "<query>" --design-system \
  --variance 6 --motion 5 --density 8 -f markdown
```

Useful domains for this project: `ux`, `web` (`data/app-interface.csv`),
`typography`, `color`, `react` (`data/react-performance.csv`), and
`--stack react`.

---

## Project adoption policy

Both skills were written primarily for marketing sites, landing pages, and
mobile apps. Translunar CAT is a dense professional desktop workbench.
`design-taste-frontend` §13 explicitly excludes dashboards, dense product UI,
data tables, and multi-step forms, so neither skill may be applied wholesale.

The INSTRUMENT token set in `packages/ui/src/tokens.css` is the design
authority for this repository. When a skill rule and the token set disagree,
the token set wins.

### Adopted

- Three-dial method (variance / motion / density) with project values
  `6 / 5 / 8`.
- Complete interaction-state coverage: loading, empty, error, pending,
  disabled, `:active` tactile feedback.
- Button and form contrast checks; no CTA label wrapping at desktop width.
- Shape consistency lock, colour consistency lock, page theme lock.
- Icon discipline: one icon family, no hand-rolled SVG icon paths, no emoji
  as structural icons.
- Animate `transform` and `opacity` only; honour `prefers-reduced-motion`.
- No `back.out`-style overshoot easing on dense data tables.
- Z-index restraint through named layer tokens.
- Never use a placeholder as a label.
- Copy discipline: no filler verbs (`Elevate`, `Seamless`, `Unleash`), no
  em-dash or en-dash in visible copy, no fake-precise invented numbers, no
  decorative status dots, no scroll cues, no version stamps.
- Virtualise long lists; keep CLS low; reserve space for async content.
- WCAG AA contrast, visible focus, keyboard reachability.

### Rejected (with reason)

| Rule | Reason |
| --- | --- |
| Tailwind v4 / Motion / Next.js / GSAP stack defaults | The renderer is React + Vite + vanilla CSS by contract. |
| Landing-page composition (hero, bento, marquee, logo wall, scroll hijack) | This is an application shell, not a marketing page. |
| Glassmorphism and `backdrop-filter` | Forbidden by the project material policy. |
| `ui-ux-pro-max` navy/green palette and Fira type pairing | Conflicts with the INSTRUMENT token set (cold grays, one deep-blue accent). |
| Mobile breakpoints, touch targets, safe areas, haptics | Windows and macOS desktop only. |
