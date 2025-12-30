// compat.js
// The file used for gnome compat API.

// GNOME constantly has breaking changes and it's not fun to keep up with these
// changes. This file abstracts away some of these differences.

import Meta from "gi://Meta";

function _normalizeMaximize(metaWindow) {
	const flags = metaWindow.get_maximize_flags?.() ?? 0;
	const hFlag = Meta.MaximizeFlags.HORIZONTAL ?? 1;
	const vFlag = Meta.MaximizeFlags.VERTICAL ?? 2;
	const bothFlag = Meta.MaximizeFlags.BOTH ?? hFlag | vFlag;

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

export function getMaximizeState(metaWindow) {
	return _normalizeMaximize(metaWindow);
}

export function getWindowState(
	metaWindow,
	actor,
	box,
	maximizeOverride = null,
) {
	const width = box.x2 - box.x1;
	const height = box.y2 - box.y1;

	const frame = metaWindow.get_frame_rect();
	const workarea = metaWindow.get_work_area_current_monitor();
	const maximize = maximizeOverride ?? _normalizeMaximize(metaWindow);

	return {
		actorSize: { width, height },
		frame,
		workarea,
		maximize,
		isFullscreen: !!metaWindow.fullscreen,
		isFocused: metaWindow === global.display.focus_window,
	};
}

export function applyBorderState(border, state, borderColor) {
	if (!state.visible) {
		border.visible = false;
		border._lastStyleKey = null;
		return;
	}

	border.set_position(state.pos.x, state.pos.y);
	border.set_size(state.size.width, state.size.height);

	const { borderWidths, radius } = state;
	const styleKey =
		`${borderWidths.top},${borderWidths.right},${borderWidths.bottom},${borderWidths.left}|` +
		`${radius.tl},${radius.tr},${radius.br},${radius.bl}|${borderColor}`;

	if (border._lastStyleKey !== styleKey) {
		border._lastStyleKey = styleKey;
		const styleString =
			`border-top-width: ${borderWidths.top}px;` +
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
}
