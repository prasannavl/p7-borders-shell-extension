# GNOME Extension that adds window borders to windows based on config efficiently

- `common/` contains code shared by the Shell extension and preferences:
  application config rules and validation, border-state policy, and GSettings
  configuration management.
- `shell/` contains Shell-only integration: border lifecycle management, Mutter
  compatibility, and asynchronous window tracking.
- `prefs/` contains preferences-only configuration storage and UI code.
- Keep `extension.js` and `prefs.js` as thin GNOME entrypoints.

- Adds a **per-window border** as a child of MetaWindowActor

  - Supports:
    - **Inner vs outer** margins
    - **Per-side margins** (top/right/bottom/left)
    - **Per-corner radius** (tl/tr/br/bl)
    - **Edge-aware hiding** (skip borders when touching screen edges)
  - Uses **inline CSS** for per-side border widths, radius, and color.
  - **Caches** the complete style so set_style() isn’t called unless needed.

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
  - Hides the border when disabled, width is zero, geometry is invalid, the
    window is fullscreen or fully maximized, maximized borders are disabled, or
    edge handling hides every side.
  - Caches CSS so set_style() runs only when something actually changes.

Compatibility:

- Tier 1: GNOME 50 (actively tested).
- Tier 2: GNOME 45+ (works, best effort).

Programming styles:

- Simplicity is a MUST. Keep the code as simpler as possible.
- Avoid excessive defensiveness when not necessary.
- Avoid duplication and promote reusability as much as possible.
- Add a guard or `try`/`catch` only for a concrete failure boundary, such as
  untrusted input, external I/O, disposed GObjects, or transactional cleanup.
  Every defense must own recovery, rollback, reporting, or an invariant; avoid
  speculative checks and checks already enforced by the owning abstraction.
- Lightweight optional chaining and nullish fallbacks are fine; scrutinize
  defenses that require additional branching, state, or exception handling.

### Operations

#### Update version

- When asked to set a new version:
  - Inside a `nix develop` env, run `make fmt`, `make clean` and `make pack`
  - Then increment the version in `metadata.json`
  - Add a new entry to change log with the current date and version info
  - Once all of this is done, stage all the changes, and ask me if we can commit
    with the message "Update version: <version-number>"
