# GNOME Extension that adds window borders to windows based on config efficiently

- Adds a **per-window border** as a child of MetaWindowActor

  - Supports:
    - **Inner vs outer** margins
    - **Per-side margins** (top/right/bottom/left)
    - **Per-corner radius** (tl/tr/br/bl)
    - **Edge-aware hiding** (skip borders when touching screen edges)
  - Uses **CSS**, but:
    - Only a **fixed style class** (p7-border) for color/etc.
    - Computes **inline border-width + border-radius**
    - **Caches** the style so set_style() isn’t called unless needed

  - Floating window → not touching any edge → all margins active → full border
    with configured per-corner radius.
  - Vertically maximized → touches top & bottom workarea edges → top/bottom
    margins become 0, left/right remain → only left/right border drawn.
  - → corners touching edges get radius 0 (so window flushes nicely to
    top/bottom).
  - Fully maximized → touching all 4 edges → all margins 0 → border-width 0 on
    all sides → border disappears.
  - Different apps / WM_CLASS → getConfigForWindow chooses config based on
    gtk-application-id or wm_class, so you can have per-app margins/radii.
  - Uses per-side margins + per-corner radius.
  - Hides borders automatically when touching edges (maximized, snapped, etc.).
  - Early-outs when either:
    - Config margins are all zero, or
    - Effective margins (after edge logic) are all zero.
    - Caches CSS so set_style() runs only when something actually changes.

Compatibility:

- GNOME 48, 49 in particular.

Programming styles:

- Simplicity is a MUST. Keep the code as simpler as possible.
- Avoid excessive defensiveness when not necessary.
- Avoid duplication and promote reusability as much as possible.
