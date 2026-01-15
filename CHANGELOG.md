# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [33] - 2025-01-15

- Enable by default: `default-maximized-borders` and `modal-enabled`
- Simplify handling for config settings migration and defaults.

## [32] - 2025-01-15

- Regression fix: Progagate defaults correctly on unknown windows.

## [31] - 2025-01-15

- Simplify defaults

## [30] - 2025-01-14

- Automatic detection logic to handle default borders.
- Margins are simpler with effective compositor area calc using both
  `frame_rect` and `buffer_rect` to take into account non frame area like
  shadows.

## [27] - 2025-01-11

- Regression fix: Re-enable borders due to improper actors check.

## [26] - 2025-01-10

- Internal: Better safety against disposed actors.

## [24] - 2025-01-09

- Internal cleanup.

## [23] - 2025-01-08

- More robust tracking and cleanup handling.

## [22] - 2025-01-08

- Option: `verbose-logging`: Toggle to enable track/untrack debug logs.

## [21] - 2025-01-08

- Regression fix: Fixes the tracker cleanup logic bug that was introduced in v20
  and some more code clean-up.

## [20] - 2025-01-08

- Bugfix: Preferences: Debounced config changes, more reslient UI.

## [19] - 2025-01-08

### Added

- Make all class and app matching case in-sensitive by default.
  - For case specific matching, the regex prefixes can be used.

- Option: `modal-enabled` (default: `false`)
  - By default we now only apply to top level windows only skipping models. This
    is default since can't know what toolkits or margins the modals will use
    that can defer from the top level window. The option is there to enable
    older behavior if needed.

- Bugfix: Preferences: app config add, remove, delete inconsistencies in the UI.
- Updated config.

## [1] - 2025-12-27

### Added

- Feature complete release.
