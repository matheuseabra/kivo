---
name: tweak
description: Use to tune a single-file HTML page in the browser.
disable-model-invocation: true
---

# Tweak HTML

Add a temporary live-control panel to a self-contained HTML artifact, let the
user tune visual values in a browser, then apply the resulting values to the
source and remove the panel.

## When To Use

- The user asks to tune, tweak, or dial in a generated HTML page, mockup,
  report, presentation, or prototype.
- The target is a single HTML file or an exported standalone preview.

Do not use this to edit a production application built from multiple source
files. Modify its source styles directly instead.

## Inject

1. Identify the exact HTML file. Ask if more than one plausible target exists.
2. Read the file and confirm it has not already been injected by searching for
   `TWEAK:START`.
3. Read `assets/panel.html` from this skill directory and insert the complete
   block immediately before the final `</body>` tag.
4. Save the target without changing unrelated content.
5. Open it with an available browser or preview tool and tell the user to use
   the visible controls. `T` toggles the panel, `R` resets it, and `B` copies
   an export payload.

## Bake

When the user supplies an `AGENT_TWEAK_v1` payload:

1. Read the target HTML and map each non-default value to the narrowest
   existing CSS rule or design token. Preserve the document's established
   style instead of appending broad overrides by default.
2. Apply only values present in the payload.
3. Remove the complete block from `<!-- TWEAK:START -->` through
   `<!-- TWEAK:END -->`.
4. Verify that the marker is absent and the resulting page still renders.
5. Report the baked values and file changed.

## Strip

On `tweak strip`, remove only the marked panel block. Do not alter the page's
source styling or silently discard user-selected values.

## Verification

- Confirm the panel injects once, controls alter the preview, reset restores
  defaults, and the exported payload reflects non-default controls.
- Confirm baking removes the panel and does not leave marker comments or
  temporary selectors behind.

## Attribution

Adapted for general agents from `robonuggets/skills`:
https://github.com/robonuggets/skills
