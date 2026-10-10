# LED ring spin test

One blue pixel chasing around a 16-LED WS2812 ring on **D6**. No BLE.

## Wiring

| Ring | XIAO |
|------|------|
| DIN  | **D6** |
| 5V   | **5V** (USB-powered) |
| GND  | **GND** |

## Flash

Same board you used for Stage 1 (`xiaoblesense` if the Mac lists Sense):

```bash
cd firmware/led-ring-spin-test
pio run -e xiaoblesense -t upload
pio device monitor -e xiaoblesense -b 115200
```

Non-Sense board: use `-e xiaoble` instead.

Expect serial: `LED ring spin test` and a blue light moving around the ring.
