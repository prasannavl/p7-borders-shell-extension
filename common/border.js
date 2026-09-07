const EDGE_EPS = 2;
export const BORDER_SIDES = ["top", "right", "bottom", "left"];
export const BORDER_CORNERS = ["tl", "tr", "br", "bl"];
const ZERO_RADIUS = Object.fromEntries(
  BORDER_CORNERS.map((corner) => [corner, 0]),
);

export function computeBorderState(windowState, config) {
  const {
    box,
    frame,
    buffer,
    workarea,
    isFullscreen,
    maximize,
    isFocused,
  } = windowState;
  const { margins, radius, width: borderWidth } = config;
  const radiusEnabled = BORDER_CORNERS.some((corner) => radius[corner]);

  if (
    !workarea ||
    isFullscreen ||
    maximize.full ||
    (!config.maximizedBorder && maximize.any) ||
    !borderWidth ||
    !config.enabled
  ) {
    return { visible: false };
  }

  // Exclude shadows and other buffer-only space from border geometry.
  const effectiveFrame = buffer
    ? {
      x: frame.x - buffer.x,
      y: frame.y - buffer.y,
      width: frame.width,
      height: frame.height,
    }
    : {
      x: 0,
      y: 0,
      width: box.width,
      height: box.height,
    };

  const { width, height } = effectiveFrame;
  if (width <= 0 || height <= 0) return { visible: false };

  const edgeThreshold = Math.max(EDGE_EPS, borderWidth);
  const edges = {
    left: Math.abs(frame.x - workarea.x) <= edgeThreshold,
    right: Math.abs(frame.x + frame.width - (workarea.x + workarea.width)) <=
      edgeThreshold,
    top: Math.abs(frame.y - workarea.y) <= edgeThreshold,
    bottom: Math.abs(frame.y + frame.height - (workarea.y + workarea.height)) <=
      edgeThreshold,
  };

  const borderWidths = hideTouchedEdges(edges, () => borderWidth);
  if (BORDER_SIDES.every((side) => !borderWidths[side])) {
    return { visible: false };
  }

  const effectiveMargins = hideTouchedEdges(edges, (side) => margins[side]);

  const effectiveRadius = !radiusEnabled || maximize.any ? ZERO_RADIUS : {
    tl: edges.top || edges.left ? 0 : radius.tl,
    tr: edges.top || edges.right ? 0 : radius.tr,
    br: edges.bottom || edges.right ? 0 : radius.br,
    bl: edges.bottom || edges.left ? 0 : radius.bl,
  };

  return {
    visible: true,
    borderWidths,
    borderColor: isFocused ? config.activeColor : config.inactiveColor,
    radius: effectiveRadius,
    pos: {
      x: effectiveFrame.x - effectiveMargins.left - borderWidths.left,
      y: effectiveFrame.y - effectiveMargins.top - borderWidths.top,
    },
    size: {
      width: Math.max(
        1,
        width +
          effectiveMargins.left +
          effectiveMargins.right +
          borderWidths.left +
          borderWidths.right,
      ),
      height: Math.max(
        1,
        height +
          effectiveMargins.top +
          effectiveMargins.bottom +
          borderWidths.top +
          borderWidths.bottom,
      ),
    },
  };
}

function hideTouchedEdges(edges, getValue) {
  return Object.fromEntries(
    BORDER_SIDES.map((side) => [side, edges[side] ? 0 : getValue(side)]),
  );
}
