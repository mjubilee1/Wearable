# BLE ring green test

Solid **green** on the 16-LED ring (DIN **D6**) while another Nearby XIAO is heard over BLE. **Off** when alone.

## Setup (one ring board)

1. Keep the ring on the board you just tested (DIN → D6).
2. Flash **this** sketch onto that board only.
3. Power your **other** XIAO with Stage 1 still on it (no ring needed) — it only has to advertise.

```bash
cd firmware/ble-ring-green-test
pio run -e xiaoblesense -t upload
pio device monitor -e xiaoblesense -b 115200
```

## What you should see

| Situation | Ring | Serial |
|-----------|------|--------|
| Right after flash/boot | Solid green **15s** | `Self-test: solid GREEN…` |
| After self-test, alone | Off | `Waiting for a Nearby peer…` |
| Peer within ~2 ft (RSSI ≥ -58) | Solid green | `peer rssi=… — ring GREEN` |
| Peer farther away | Off | `peer lost — ring OFF` |

Tune range in `include/config.h` → `RSSI_IN_RANGE_DBM` (higher / closer to 0 = shorter range).
