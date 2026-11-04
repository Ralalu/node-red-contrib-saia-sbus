# node-red-contrib-saia-sbus

Node-RED nodes for communicating with **SAIA PCD** controllers via the **EtherSBus** protocol (UDP port 5050).

Based on protocol reverse-engineering.

---

## Installation

**Via the Node-RED Palette Manager (recommended):**
Menu → *Manage palette* → *Install* → search for `node-red-contrib-saia-sbus`.

**Via npm**, from your Node-RED user directory (usually `~/.node-red`):

```bash
npm install node-red-contrib-saia-sbus
```

Then restart Node-RED.

Requirements: Node-RED >= 2.0, Node.js >= 14.

---

## Nodes

All nodes appear in the **SAIA SBus** palette category.

### 🔧 `saia-config` (Configuration)

Shared connection configuration - reused across all other nodes.

| Setting   | Default         | Description                         |
| --------- | --------------- | ----------------------------------- |
| Host / IP | `192.168.1.100` | IP address of the SAIA PCD          |
| UDP Port  | `5050`          | EtherSBus port (almost always 5050) |
| Station   | `1`             | SBus station address (0–253)        |
| Timeout   | `2000` ms       | Response timeout per request        |

> **Important:** EtherSBus must be enabled on your PCD (PG5 → Hardware Settings → Ethernet → EtherSBus).

---

### 📥 `saia-read`

Reads one or more items from the PCD. Triggered by any incoming message.

**Configure in node:**

- Item Type: `flag` | `input` | `output` | `register`
- Address: start address
- Count: number of items (returns array if > 1)
- Topic: MQTT-style topic string (auto-generated if blank)

**Override per message:**

```js
msg.itemType = "register"; // override item type
msg.address = 50; // override address
msg.count = 4; // override count
```

**Output:**

```js
msg.payload; // value or array of values
msg.itemType; // 'register'
msg.address; // 50
msg.topic; // 'saia/register/50'
```

---

### 📤 `saia-write`

Writes one or more items to the PCD.

**Input:**

```js
msg.payload = 42; // single write
msg.payload = [1, 2, 3]; // multi write (array)
msg.payload = true; // flag/output (boolean)
```

**Notes:**

- Inputs are **read-only** and cannot be written
- Registers accept **32-bit signed integers**
- Flags/Outputs accept **booleans** (packed as bits on the wire)

---

### 🔄 `saia-poll`

Cyclically polls a PCD item at a configurable interval and emits a message each time.

| Setting      | Default   | Description                              |
| ------------ | --------- | ---------------------------------------- |
| Interval     | `1000` ms | Polling cycle time                       |
| Only Changes | off       | When enabled, only emits on value change |

An incoming message triggers an **immediate extra poll** (useful for manual refresh).

**Output:**

```js
msg.payload; // value or array
msg.timestamp; // Date.now() at time of read
msg.itemType; // 'register'
msg.address; // 0
msg.topic; // 'saia/register/0'
```

---

## Item Types & SAIA Notation

| node-red-contrib type | SAIA notation | Read | Write | Data type |
| --------------------- | ------------- | ---- | ----- | --------- |
| `flag`                | F             | ✓    | ✓     | boolean   |
| `input`               | I             | ✓    | ✗     | boolean   |
| `output`              | O             | ✓    | ✓     | boolean   |
| `register`            | R             | ✓    | ✓     | int32     |

---

## Example Flow

After installation the examples are available in Node-RED via
**Menu → Import → Examples → node-red-contrib-saia-sbus**.

[`examples/saia-poll.json`](examples/saia-poll.json) polls flag F100 every 500 ms (on change only) and
registers R0..R4 every 2 s, with an inject node that triggers an immediate extra poll.

[`examples/saia-http-api.json`](examples/saia-http-api.json) exposes a small HTTP API on top of the SAIA nodes:

- `GET  /saia/read?type=register&addr=0&count=1` – read items via `saia-read`
- `POST /saia/write` with JSON body `{ "type", "addr", "value" }` – write items via `saia-write`

---

## SAIA PCD Configuration Tips

1. **Enable EtherSBus**: PG5 → Hardware Settings → Ethernet → enable EtherSBus
2. **Use static addresses**: Don't use dynamic addressing in PG5.
3. **Station address**: Default is usually 1. Check your PCD hardware settings.
4. **Firewall**: UDP port 5050 must be open between Node-RED host and PCD.

---

## Protocol Notes

The current implementation is based on:

- Wireshark decoding of real SAIA traffic
- Live packet captures from working gateway requests and responses

### Confirmed Request Layout

For a simple single-item read request, the wire format is:

```
Bytes 0-3:   Frame length in bytes (uint32 BE, includes CRC)
Byte 4:      Version
Byte 5:      Protocol type
Bytes 6-7:   Sequence number (uint16 BE)
Byte 8:      Telegram attribute / control (`0x00` for a request)
Byte 9:      Station address
Byte 10:     Command code
Byte 11:     Read count minus 1 (`0x00` for 1 item, `0x02` for 3 items)
Bytes 12-13: Base address (uint16 BE)
Bytes 14-15: CRC16/XMODEM
```

Example: read register `100` from station `50`

```text
00 00 00 10 00 00 01 d4 00 32 06 00 00 64 d1 90
```

Decoded:

- Length: `0x00000010` = `16`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x01d4`
- Attribute: `0x00`
- Station: `0x32` = `50`
- Command: `0x06` = read registers
- Address: `0x000064` = `100`
- CRC16/XMODEM: `0xd190`

Example: read 3 registers starting at `100`

```text
00 00 00 10 00 00 00 18 00 32 06 02 00 64 dc 5d
```

Decoded:

- Length: `0x00000010` = `16`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x0018` = `24`
- Attribute: `0x00`
- Station: `0x32` = `50`
- Command: `0x06` = read registers
- R-count: `0x02` = `3` items
- Base address: `0x0064` = `100`
- CRC16/XMODEM: `0xdc5d`

### Confirmed Response Layout

For the matching register response, Wireshark showed:

```text
00 00 00 0f 00 00 00 01 01 00 00 03 ed c0 90
```

Decoded:

- Length: `0x0000000f` = `15`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x0001`
- Telegram attribute: `0x01` (response)
- Data: `00 00 03 ed`
- CRC16/XMODEM: `0xc090`

`00 00 03 ed` is the S-Bus 32-bit value `1005`.

For a 3-register response, Wireshark showed:

```text
00 00 00 17 00 00 00 01 01 00 00 00 01 00 00 00 15 00 00 11 c1 09 29
```

Decoded:

- Length: `0x00000017` = `23`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x0001`
- Telegram attribute: `0x01` (response)
- Data[0]: `00 00 00 01` = `1`
- Data[1]: `00 00 00 15` = `21`
- Data[2]: `00 00 11 c1` = `4545`
- CRC16/XMODEM: `0x0929`

### Confirmed Write Register Request Layout

For a single register write request, Wireshark showed:

```text
00 00 00 14 00 00 00 0d 00 32 0e 05 00 65 00 00 5f e7 82 a8
```

Decoded:

- Length: `0x00000014` = `20`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x000d` = `13`
- Telegram attribute: `0x00` (request)
- Destination: `0x32` = `50`
- Command: `0x0e` = write registers
- W-count raw: `0x05`
- Base address: `0x0065` = `101`
- Data: `00 00 5f e7` = `24551`
- CRC16/XMODEM: `0x82a8`

For register writes, the currently confirmed payload format is:

```text
Byte 11:     W-count raw = 1 + 4 * number_of_values
Bytes 12-13: Base address (uint16 BE)
Bytes 14..:  32-bit values (int32 BE)
```

For a multi-register write request, Wireshark showed:

```text
00 00 00 20 00 00 00 01 00 32 0e 11 00 64 00 00 00 01 00 00 00 02 00 00 00 03 00 00 00 04 15 bf
```

Decoded:

- Length: `0x00000020` = `32`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x0001`
- Telegram attribute: `0x00` (request)
- Destination: `0x32` = `50`
- Command: `0x0e` = write registers
- W-count raw: `0x11` = `17`
- Base address: `0x0064` = `100`
- Data[0]: `00 00 00 01` = `1`
- Data[1]: `00 00 00 02` = `2`
- Data[2]: `00 00 00 03` = `3`
- Data[3]: `00 00 00 04` = `4`
- CRC16/XMODEM: `0x15bf`

For a single flag write request, Wireshark showed:

```text
00 00 00 12 00 00 00 01 00 32 0b 03 00 64 00 01 34 c5
```

Decoded:

- Length: `0x00000012` = `18`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x0001`
- Telegram attribute: `0x00` (request)
- Destination: `0x32` = `50`
- Command: `0x0b` = write flags
- W-count raw: `0x03`
- Base address: `0x0064` = `100`
- FIO / bit payload: `0x0001`
- CRC16/XMODEM: `0x34c5`

For flag writes, the currently confirmed payload format is:

```text
Byte 11:     W-count raw = 3 for a single flag write
Bytes 12-13: Base address (uint16 BE)
Bytes 14-15: FIO / packed bit payload (uint16 BE)
```

For a multi-flag write request, Wireshark showed:

```text
00 00 00 12 01 00 d2 ff 00 32 0b 03 00 64 04 0a f1 33
```

Decoded:

- Length: `0x00000012` = `18`
- Version: `0x01`
- Protocol type: `0x00`
- Sequence: `0xd2ff` = `54015`
- Telegram attribute: `0x00` (request)
- Destination: `0x32` = `50`
- Command: `0x0b` = write flags
- W-count raw: `0x03`
- Base address: `0x0064` = `100`
- FIO count minus 1: `0x04` = `5` bits
- Packed bits: `0x0a`
- CRC16/XMODEM: `0xf133`

For multi-flag writes, the currently confirmed payload format is:

```text
Byte 11:     W-count raw = 2 + number_of_data_bytes
Bytes 12-13: Base address (uint16 BE)
Byte 14:     FIO count minus 1
Bytes 15..:  Packed bit payload
```

The same binary write payload structure is also confirmed for outputs. Wireshark
showed this output write request:

```text
00 00 00 14 00 00 00 01 00 32 0d 05 00 20 10 94 29 01 0b 62
```

Decoded:

- Length: `0x00000014` = `20`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x0001`
- Telegram attribute: `0x00` (request)
- Destination: `0x32` = `50`
- Command: `0x0d` = write outputs
- W-count raw: `0x05`
- Base address: `0x0020` = `32`
- FIO count minus 1: `0x10` = `17` bits
- Packed bits: `94 29 01`
- CRC16/XMODEM: `0x0b62`

### Confirmed Write ACK Layout

For a successful write acknowledgment, Wireshark showed:

```text
00 00 00 0d 00 00 00 01 02 00 00 4e b0
```

Decoded:

- Length: `0x0000000d` = `13`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x0001`
- Telegram attribute: `0x02` = ACK/NAK
- ACK/NAK code: `0x0000` = ACK
- CRC16/XMODEM: `0x4eb0`

For a single flag response, Wireshark showed:

```text
00 00 00 0c 00 00 00 01 01 00 56 6a
```

Decoded:

- Length: `0x0000000c` = `12`
- Version: `0x00`
- Protocol type: `0x00`
- Sequence: `0x0001`
- Telegram attribute: `0x01` (response)
- Data: `00`
- CRC16/XMODEM: `0x566a`

In this case, the returned flag value is `false`.

### CRC

The checksum matches `CRC16/XMODEM` over the complete frame except the final
2 CRC bytes.

Example:

- frame without CRC: `00 00 00 10 00 00 01 d4 00 32 06 00 00 64`
- CRC16/XMODEM: `d1 90`

### Current Status Of This Repository

At the moment, the implementation in `nodes/sbus-protocol.js` is confirmed to
work for:

- single and multi-item reads for registers, flags, inputs and outputs
- CRC validation on received frames
- single and multi-item writes for registers, flags and outputs
- automatic chunking of oversized reads (`32` for 32-bit values, `128` for bit values)
- automatic chunking of oversized writes (`32` for 32-bit values, `256` for bit values)

Current limitations:

- timer and counter write behavior still needs confirmation with captures
- the exact multi-read request semantics are inferred from captures and should be
  validated with additional Wireshark traces

These notes should be treated as reverse-engineered findings, not official SAIA
documentation.

---

## License

MIT
