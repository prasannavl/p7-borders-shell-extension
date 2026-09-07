// compat.js
// The file used for gnome compat API.

// GNOME constantly has breaking changes and it's not fun to keep up with these
// changes. This file abstracts away some of these differences.

import { BORDER_CORNERS, BORDER_SIDES } from "../common/border.js";

export function getMaximizeState(metaWindow) {
  const flags = metaWindow.get_maximize_flags?.() ?? 0;
  // Meta.MaximizeFlags values are stable across the supported Shell versions.
  const hFlag = 1;
  const vFlag = 2;

  let horizontal = !!metaWindow.maximized_horizontally;
  let vertical = !!metaWindow.maximized_vertically;

  if (flags) {
    horizontal = (flags & hFlag) !== 0;
    vertical = (flags & vFlag) !== 0;
  }

  const any = horizontal || vertical;
  return { any, full: horizontal && vertical, horizontal, vertical };
}

export function getWindowState(metaWindow, actor) {
  const box = actor.get_allocation_box();
  const width = box.x2 - box.x1;
  const height = box.y2 - box.y1;

  const frame = metaWindow.get_frame_rect();
  const buffer = metaWindow.get_buffer_rect?.() ?? frame;

  const workarea = getWorkarea(metaWindow);
  const maximize = getMaximizeState(metaWindow);

  return {
    box: { width, height },
    frame,
    buffer,
    workarea,
    maximize,
    isFullscreen: !!metaWindow.fullscreen,
    isFocused: metaWindow === global.display.focus_window,
  };
}

export function applyBorderState(border, state, cachedStyle) {
  if (!state.visible) {
    border.visible = false;
    return null;
  }

  border.set_position(state.pos.x, state.pos.y);
  border.set_size(state.size.width, state.size.height);

  const { borderWidths, radius, borderColor } = state;
  const widths = BORDER_SIDES.map((side) => borderWidths[side]);
  const radii = BORDER_CORNERS.map((corner) => radius[corner]);
  const styleKey = `${widths}|${radii}|${borderColor}`;

  if (cachedStyle !== styleKey) {
    const styleString = BORDER_SIDES.map(
      (side, index) => `border-${side}-width: ${widths[index]}px;`,
    ).join("") +
      `border-radius: ${radii.map((value) => `${value}px`).join(" ")};` +
      "border-style: solid;" +
      `border-color: ${borderColor};` +
      "background: transparent;";
    border.set_style(styleString);
  }

  border.visible = true;
  return styleKey;
}

function getWorkarea(metaWindow) {
  const monitor = metaWindow.get_monitor();
  if (monitor < 0 || monitor >= global.display.get_n_monitors()) return null;

  return metaWindow.get_work_area_current_monitor();
}
