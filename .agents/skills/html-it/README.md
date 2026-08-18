# html-it

A Claude skill that teaches your agent to produce **HTML output instead of markdown** — across four levels of capability.

Based on [Thariq Shihipar](https://x.com/trq212)'s article [_Using Claude Code: The Unreasonable Effectiveness of HTML_](https://x.com/trq212/status/2052809885763747935). Go read the source — this skill is one community implementation of his ideas.

Live examples gallery (Thariq's): **[thariqs.github.io/html-effectiveness](https://thariqs.github.io/html-effectiveness/)**

---

## What it does

When you ask your agent for a doc, plan, report, review, design, dashboard, or editor — it builds an HTML artifact at the right level instead of dumping markdown.

**The four levels:**

| Level | What | Examples |
|-------|------|----------|
| **1 — Static Doc** | HTML as a prettier markdown | Specs, reports, explainers, plans |
| **2 — Visual Artifact** | Adds SVG, tables, layouts | Design systems, decks, dashboards |
| **3 — Two-Way Interactive** | Sliders/toggles + export button | Tuning, A/B picks, prompt iteration |
| **4 — Throwaway Tool** | Purpose-built mini-app | Triage boards, config editors |

Each level adds capability and effort. Most agent output stops at Level 1 — the unlock is recognising when you actually need 3 or 4.

---

## Install

In your Claude Code project:

```bash
git clone https://github.com/robonuggets/html-it ~/.claude/skills/html-it
```

Or for a project-specific install:

```bash
cd your-project
mkdir -p .claude/skills
git clone https://github.com/robonuggets/html-it .claude/skills/html-it
```

Then in Claude Code, the skill triggers on:

- `/html-it`
- "html-it" / "html this" / "render as html"
- "build me an html for X" / "make an html artifact"

---

## Quick prompts (one per level)

**Level 1 (static doc):**
> Read this folder and produce an HTML implementation plan — TL;DR at top, key code snippets inline, sticky TOC on the left. Easy to digest on mobile.

**Level 2 (visual artifact):**
> Read the rate limiter code. Produce a single HTML explainer page: token-bucket SVG flow at the top, 3-4 annotated code snippets, gotchas section at the bottom.

**Level 3 (two-way interactive):**
> I'm tuning this system prompt. Make a side-by-side HTML editor — editable prompt on the left with variable slots, three sample inputs on the right that re-render live. Add a character counter and a Copy as prompt button.

**Level 4 (throwaway tool):**
> I need to reprioritise these 30 tickets. Make an HTML file with each ticket as a draggable card across Now / Next / Later / Cut columns. Pre-sort by your best guess. Add a Copy as markdown button that exports the final ordering with a one-line rationale per bucket.

---

## What's in the box

- `SKILL.md` — the skill itself. Drop into `.claude/skills/html-it/` and Claude picks it up.
- `README.md` — this file.

The skill encodes:
- When to choose HTML over markdown
- The four levels and which patterns belong to each
- A locked design system (ivory/slate/clay palette, serif+sans+mono stack) so output doesn't look AI-slop
- The mandatory "export back to prompt" pattern for Level 3+
- Anti-patterns to avoid

---

## Related skills

- **[`tweak`](https://github.com/robonuggets/skills)** — Inject a live tweak panel into any HTML (5 or 10 sliders), bake selected values back into source CSS. Pairs naturally with Level 3/4 outputs from `html-it`.

---

## Credit

All credit to **[Thariq Shihipar](https://x.com/trq212)** of the Anthropic Claude Code team for the framework and the use-case taxonomy. The four-level escalation is the maintainer's reading of his article — defer to his original write-up when in doubt.

Article: [Using Claude Code — The Unreasonable Effectiveness of HTML](https://x.com/trq212/status/2052809885763747935)
Examples: [thariqs.github.io/html-effectiveness](https://thariqs.github.io/html-effectiveness/)

---

## License

MIT. Use it, fork it, improve it.

---

Built by [RoboNuggets](https://robonuggets.com).
