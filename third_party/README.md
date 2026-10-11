# Third-party reference trees

## `omi/`

Read-only clone of [BasedHardware/omi](https://github.com/BasedHardware/omi) (MIT).

- Pinned commit: see [`OMI_COMMIT.txt`](OMI_COMMIT.txt)
- Reuse map: [`docs/omi-reuse-map.md`](../docs/omi-reuse-map.md)
- **Never edit files inside `omi/`.** When we adopt a piece, copy it into `src/vendor/omi/<piece>/` (see the map) and call it through a thin wrapper outside `third_party/` and `vendor/`.
