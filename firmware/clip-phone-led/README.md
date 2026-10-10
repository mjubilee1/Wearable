# Clip phone-led

Solid **green** on the 16-LED ring only when the **phone** writes a GATT color command after a green sighting. **Off** when alone or when the phone stops refreshing (~3s).

This replaces board-to-board RSSI green (`ble-ring-green-test`). The clip does **not** scan peers.

## Flash

Ring DIN → **D6**. Flash **both** desk boards so neither self-greens from the other.

```bash
# from repo root
pnpm fw:clip
pnpm fw:clip:monitor
```

Or:

```bash
cd firmware/clip-phone-led
pio run -e xiaoblesense -t upload
pio device monitor -e xiaoblesense -b 115200
```

Serial prints `local id` (8 hex chars) for the link-ring screen.

## Desk verify

1. Flash both XIAOs with this sketch. Rings stay **off** when boards sit next to each other (no peer RSSI green).
2. Link phone account to board A’s id. Put shared interests on both profiles if testing API green.
3. Power board B (advertise only). Open Nearby on the phone in the foreground (`EXPO_PUBLIC_API_URL` = Mac LAN IP).
4. `/debug/ble` shows B’s clip id + RSSI; when API marks **green**, board **A** goes green from GATT.
5. Power off B or remove interest overlap → A goes dark within ~3s.

## GATT

| Item | Value |
|------|--------|
| Service | `4e420001-0000-1000-8000-00805f9b34fb` |
| Color char | `4e420002-0000-1000-8000-00805f9b34fb` |
| Write `0` | Ring off |
| Write `1` | Solid green |
