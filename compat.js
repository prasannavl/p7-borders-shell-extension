// compat.js
// The file used for gnome compat API.

// GNOME constantly has breaking changes and it's not fun to keep up with these
// changes. This file abstracts away some of these differences.

import Meta from "gi://Meta";

export function getMaximizeState(metaWindow) {
  const flags = metaWindow.get_maximize_flags?.() ?? 0;
  const hFlag = Meta.MaximizeFlags?.HORIZONTAL ?? 1;
  const vFlag = Meta.MaximizeFlags?.VERTICAL ?? 2;
  const bothFlag = Meta.MaximizeFlags?.BOTH ?? hFlag | vFlag;

  let horizontal = (flags & hFlag) !== 0;
  let vertical = (flags & vFlag) !== 0;

  if (!flags) {
    horizontal = !!metaWindow.maximized_horizontally;
    vertical = !!metaWindow.maximized_vertically;
  }

  const any = horizontal || vertical;
  const full = flags ? (flags & bothFlag) === bothFlag : horizontal && vertical;

  return { any, full, horizontal, vertical };
}

// Height of the server-drawn titlebar. Returns 0 for client-side decorated
// windows: the app draws its own headerbar, so there is nothing to measure
// and callers fall back to a configured height.
export function getTitlebarHeight(metaWindow) {
  if (metaWindow.is_client_decorated?.()) return 0;

  const frame = metaWindow.get_frame_rect();
  const client = metaWindow.frame_rect_to_client_rect?.(frame);
  if (!client) return 0;

  return Math.max(0, client.y - frame.y);
}

export function getWindowState(metaWindow, actor) {
  const box = actor.get_allocation_box();
  const width = box.x2 - box.x1;
  const height = box.y2 - box.y1;

  const frame = metaWindow.get_frame_rect();
  const buffer = metaWindow.get_buffer_rect?.() ?? frame;

  const workarea = metaWindow.get_work_area_current_monitor();
  const maximize = getMaximizeState(metaWindow);

  return {
    box: { width, height },
    frame,
    buffer,
    workarea,
    maximize,
    titlebarHeight: getTitlebarHeight(metaWindow),
    isFullscreen: !!metaWindow.fullscreen,
    isFocused: metaWindow === global.display.focus_window,
  };
}

// Frame position relative to the actor, with any shadow the actor draws
// discounted. Shared by the border and the title tint.
export function getEffectiveFrame({ box, frame, buffer }) {
  if (!buffer) {
    return { x: 0, y: 0, width: box.width, height: box.height };
  }
  return {
    x: frame.x - buffer.x,
    y: frame.y - buffer.y,
    width: frame.width,
    height: frame.height,
  };
}

export function applyTitleState(tint, state, cache) {
  if (!state.visible) {
    tint.visible = false;
    if (cache) cache.titleStyleCache = null;
    return;
  }

  tint.set_position(state.pos.x, state.pos.y);
  tint.set_size(state.size.width, state.size.height);

  const { color, radius } = state;
  const styleKey = `${color}|${radius.tl},${radius.tr}`;

  if (cache?.titleStyleCache !== styleKey) {
    tint.set_style(
      `background-color: ${color};` +
        `border-radius: ${radius.tl}px ${radius.tr}px 0 0;`,
    );
  }

  // Opacity lives on the actor rather than in the colour string, so the
  // configured colour can stay in any format St accepts.
  tint.opacity = state.opacity;
  tint.visible = true;
  if (cache) cache.titleStyleCache = styleKey;
}

export function applyBorderState(border, state, cache) {
  if (!state.visible) {
    border.visible = false;
    if (cache) cache.borderStyleCache = null;
    return;
  }

  border.set_position(state.pos.x, state.pos.y);
  border.set_size(state.size.width, state.size.height);

  const { borderWidths, radius, borderColor } = state;
  const styleKey =
    `${borderWidths.top},${borderWidths.right},${borderWidths.bottom},${borderWidths.left}|` +
    `${radius.tl},${radius.tr},${radius.br},${radius.bl}|${borderColor}`;

  if (cache?.borderStyleCache !== styleKey) {
    const styleString = `border-top-width: ${borderWidths.top}px;` +
      `border-right-width: ${borderWidths.right}px;` +
      `border-bottom-width: ${borderWidths.bottom}px;` +
      `border-left-width: ${borderWidths.left}px;` +
      `border-radius: ${radius.tl}px ${radius.tr}px ${radius.br}px ${radius.bl}px;` +
      "border-style: solid;" +
      `border-color: ${borderColor};` +
      "background: transparent;";
    border.set_style(styleString);
  }

  border.visible = true;
  if (cache) cache.borderStyleCache = styleKey;
}
