# GC9A01 round display

Glowing waveform for the 1.28" GC9A01 on the Seeed XIAO nRF52840 Sense. This is a separate image from `firmware/wakeword`. Wake word uses D1 as the backup button; here D1 is the display chip select.

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
