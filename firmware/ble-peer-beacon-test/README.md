# BLE peer beacon (second board)

Advertises Nearby `FF FF | N B | id` only. **No LED ring.**

## Desk setup

1. Board A (with ring): `ble-ring-green-test` → `pnpm fw:green`
2. Board B (this): `ble-peer-beacon-test` → `pnpm fw:peer`
3. Power both, bring them close → Board A ring turns green

```bash
cd firmware/ble-peer-beacon-test
pio run -e xiaoblesense -t upload
```
