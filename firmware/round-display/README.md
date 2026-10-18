# GC9A01 round display

Waveform bench for the 1.28" GC9A01. The desk image is `firmware/wakeword`, which runs this same panel and the wake word together. Flashing this folder replaces that image. The display pins match the diagram in `firmware/wakeword/README.md`. This bench has no button; in the combined image the button is D0 because D1 is chip select.

Confirm the board enumerates as USB `2886:8045` before flashing.

| Display | XIAO |
|---|---|
| GND | GND |
| VCC | 3V3 |
| SCK / SCL | D8 |
| MOSI / SDA | D10 |
| CS | D1 |
| DC | D2 |
| RST | D3 |
| BL, if present | 3V3 |

MISO is unused. Leave D9 open.

```bash
cd firmware/round-display
pio run -e xiaoblesense
pio run -e xiaoblesense -t upload
pio device monitor -e xiaoblesense -b 115200
```

`kSpiHz` is 16 MHz so breadboard jumpers stay stable. Short wiring can use 32000000.
