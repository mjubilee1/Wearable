---
name: third-party-nearby
description: >-
  Borrow third-party hardware and firmware for Nearby only after the Nearby
  product rules pass. Use when the user mentions Omi, Seeed XIAO, a third-party
  SDK or firmware tree, copying external device code, wake word, or flashing a
  board.
---

# Third-party software for Nearby

Nearby's rules win over the third-party project. Read `nearby-product-and-icp.md` and `.cursor/rules/nearby-product.mdc` before using outside code. If a third-party behavior fails a rule below, leave that behavior in the reference tree.

## Pass every rule before code lands in `firmware/`

Copy this checklist into the reply and mark each line. Stop if any line fails.

- [ ] No room recording. The mic stays on the device until "hello nearby" or the backup button, then it stops. Continuous capture, storage, or streaming fails.
- [ ] No model or API keys in firmware. The device authenticates; `apps/api` holds model keys.
- [ ] One spoken turn. The request runs the tool in that turn through `POST /v1/agent`.
- [ ] Color-ring sketches under `firmware/` stay as they are.
- [ ] AirPods go through the laptop or phone, not the board.
- [ ] Necklace prototype only. No enclosure, manufacturing, or battery polish.
- [ ] Open decisions stay open: buyer, price, subscription, press-to-talk vs always listening, and the one daily job.
- [ ] The reference tree is unchanged. `third_party/omi` is read-only.

## How to use a third-party project

1. Read the third-party build files and name their board from those files, not from a nearby sketch that targets a different board.
2. Confirm the USB identity before flashing. The desk board is a Seeed XIAO nRF52840 Sense (`2886:8045`). Omi's devkit uses that same module (`seeed_xiao_nrf52840_sense`).
3. Flash `firmware/wakeword` with `-e xiaoblesense` for that XIAO.
4. Borrow a pinout, packet layout, or idea into Nearby's own firmware. Write the adaptation so the checklist still passes.
5. Leave Omi's always-on mic, Opus stream, SD storage, and devkit speaker in `third_party/omi`. Those expect Omi's extra board, and the capture fails the room-recording rule.

## Omi, as used here

| Their fact | Nearby use |
|---|---|
| Board `seeed_xiao_nrf52840_sense` | Same module on the desk. Wake-word firmware is `firmware/wakeword`. |
| DevKit V1, V1+SPI SD, V2 Adafruit audio BFF | Extra hardware. Do not flash those images onto the bare XIAO. |
| Zephyr app that captures and broadcasts continuously | Reference only. Do not vendor it into `firmware/`. |
