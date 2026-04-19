"use strict";

/**
 * SAIA EtherSBus Protocol Implementation
 * Based on reverse-engineering documented in digimat/digimat-saia and
 * packet captures decoded by Wireshark.
 *
 * Confirmed request layout for a simple single-item read:
 *   [0..3]    Frame length (uint32 BE, including CRC)
 *   [4]       Version
 *   [5]       Protocol type
 *   [6..7]    Sequence number (uint16 BE)
 *   [8]       Control / flags (observed as 0x00 for simple reads)
 *   [9]       Station address (0-253)
 *   [10]      Command code
 *   [11..n]   Command-specific data
 *   [n+1..n+2] CRC16/XMODEM over all previous bytes
 */

const dgram = require("dgram");

const CMD = {
  READ_FLAGS: 0x02,
  READ_INPUTS: 0x03,
  READ_OUTPUTS: 0x05,
  READ_REGISTERS: 0x06,
  READ_TIMERS: 0x07,
  READ_COUNTERS: 0x08,
  WRITE_FLAGS: 0x0b,
  WRITE_OUTPUTS: 0x0d,
  WRITE_REGISTERS: 0x0e,
  WRITE_TIMERS: 0x0f,
  WRITE_COUNTERS: 0x10,
  READ_DBX: 0x16,
  WRITE_DBX: 0x17,
};

const ITEM_TYPES = {
  flag: {
    read: CMD.READ_FLAGS,
    write: CMD.WRITE_FLAGS,
    label: "Flag",
    binary: true,
  },
  input: { read: CMD.READ_INPUTS, write: null, label: "Input", binary: true },
  output: {
    read: CMD.READ_OUTPUTS,
    write: CMD.WRITE_OUTPUTS,
    label: "Output",
    binary: true,
  },
  register: {
    read: CMD.READ_REGISTERS,
    write: CMD.WRITE_REGISTERS,
    label: "Register",
    binary: false,
  },
  timer: {
    read: CMD.READ_TIMERS,
    write: CMD.WRITE_TIMERS,
    label: "Timer",
    binary: false,
  },
  counter: {
    read: CMD.READ_COUNTERS,
    write: CMD.WRITE_COUNTERS,
    label: "Counter",
    binary: false,
  },
};

function getMaxReadCount(type) {
  return type.binary ? 128 : 32;
}

function getMaxWriteCount(type) {
  return type.binary ? 256 : 32;
}

function crc16Xmodem(buf) {
  let crc = 0x0000;
  for (const byte of buf) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

function writeUInt16BEChecked(buf, value, offset) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(
      `Address out of range for 16-bit EtherSBus field: ${value}`,
    );
  }
  buf.writeUInt16BE(value, offset);
}

function buildFrame(seq, station, cmd, data, control = 0x00) {
  const frameLength = 4 + 1 + 1 + 2 + 1 + 1 + 1 + data.length + 2;
  const buf = Buffer.alloc(frameLength);

  buf.writeUInt32BE(frameLength, 0);
  buf[4] = 0x00;
  buf[5] = 0x00;
  buf.writeUInt16BE(seq & 0xffff, 6);
  buf[8] = control & 0xff;
  buf[9] = station & 0xff;
  buf[10] = cmd & 0xff;
  data.copy(buf, 11);

  const crc = crc16Xmodem(buf.subarray(0, buf.length - 2));
  buf.writeUInt16BE(crc, buf.length - 2);
  return buf;
}

function buildReadRequest(seq, station, cmd, address, count) {
  if (!Number.isInteger(count) || count < 1 || count > 256) {
    throw new Error(`Invalid EtherSBus read count: ${count}`);
  }

  const data = Buffer.alloc(3);
  data[0] = (count - 1) & 0xff;
  writeUInt16BEChecked(data, address, 1);
  return buildFrame(seq, station, cmd, data, 0x00);
}

function buildWriteRequest(seq, station, cmd, address, values, isBinary) {
  let dataBuf;
  if (isBinary) {
    const byteCount = Math.ceil(values.length / 8);
    dataBuf = Buffer.alloc(1 + 2 + 1 + byteCount);
    dataBuf[0] = 2 + byteCount;
    writeUInt16BEChecked(dataBuf, address, 1);
    dataBuf[3] = (values.length - 1) & 0xff;
    for (let i = 0; i < values.length; i++) {
      if (values[i]) {
        dataBuf[4 + Math.floor(i / 8)] |= 1 << (i % 8);
      }
    }
  } else {
    dataBuf = Buffer.alloc(1 + 2 + values.length * 4);
    dataBuf[0] = 1 + values.length * 4;
    writeUInt16BEChecked(dataBuf, address, 1);
    values.forEach((value, index) => {
      dataBuf.writeInt32BE(value, 3 + index * 4);
    });
  }

  return buildFrame(seq, station, cmd, dataBuf);
}

function parseResponse(buf, isBinary, count) {
  if (!buf || buf.length < 12) {
    throw new Error("Response too short");
  }

  const advertisedLength = buf.readUInt32BE(0);
  if (advertisedLength !== buf.length) {
    throw new Error(
      `Unexpected frame length ${buf.length} (header says ${advertisedLength})`,
    );
  }

  const actualCrc = buf.readUInt16BE(buf.length - 2);
  const expectedCrc = crc16Xmodem(buf.subarray(0, buf.length - 2));
  if (actualCrc !== expectedCrc) {
    throw new Error(
      `CRC mismatch: got 0x${actualCrc.toString(16).padStart(4, "0")}, expected 0x${expectedCrc
        .toString(16)
        .padStart(4, "0")}`,
    );
  }

  const seq = buf.readUInt16BE(6);
  const frameType = buf[8];
  const data = buf.slice(9, -2);

  if (isBinary) {
    const values = [];
    for (let i = 0; i < count; i++) {
      const byte = data[Math.floor(i / 8)] || 0;
      values.push(!!(byte & (1 << (i % 8))));
    }
    return { seq, frameType, values };
  }

  const values = [];
  for (let i = 0; i < count; i++) {
    if (data.length >= (i + 1) * 4) {
      values.push(data.readInt32BE(i * 4));
    }
  }
  return { seq, frameType, values };
}

function parseAckResponse(buf) {
  if (!buf || buf.length < 13) {
    throw new Error("ACK/NAK response too short");
  }

  const advertisedLength = buf.readUInt32BE(0);
  if (advertisedLength !== buf.length) {
    throw new Error(
      `Unexpected ACK/NAK frame length ${buf.length} (header says ${advertisedLength})`,
    );
  }

  const actualCrc = buf.readUInt16BE(buf.length - 2);
  const expectedCrc = crc16Xmodem(buf.subarray(0, buf.length - 2));
  if (actualCrc !== expectedCrc) {
    throw new Error(
      `CRC mismatch: got 0x${actualCrc.toString(16).padStart(4, "0")}, expected 0x${expectedCrc
        .toString(16)
        .padStart(4, "0")}`,
    );
  }

  const seq = buf.readUInt16BE(6);
  const frameType = buf[8];
  const code = buf.readUInt16BE(9);
  return { seq, frameType, code };
}

class SBusClient {
  constructor(host, port, station, timeout) {
    this.host = host;
    this.port = port || 5050;
    this.station = station || 1;
    this.timeout = timeout || 2000;
    this._seq = 0;
    this._pending = new Map();
    this._socket = null;
    this._init();
  }

  _init() {
    this._socket = dgram.createSocket("udp4");
    this._socket.on("message", (msg) => this._onMessage(msg));
    this._socket.on("error", (err) => {
      for (const [, pending] of this._pending) {
        clearTimeout(pending.timer);
        pending.reject(err);
      }
      this._pending.clear();
    });
    this._socket.bind();
  }

  _onMessage(msg) {
    if (msg.length < 8) {
      return;
    }

    const seq = msg.readUInt16BE(6);
    const pending = this._pending.get(seq);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this._pending.delete(seq);
    pending.resolve(msg);
  }

  _nextSeq() {
    this._seq = (this._seq + 1) & 0xffff;
    return this._seq;
  }

  _send(buf) {
    return new Promise((resolve, reject) => {
      const seq = buf.readUInt16BE(6);
      const timer = setTimeout(() => {
        this._pending.delete(seq);
        reject(new Error(`Timeout waiting for seq ${seq}`));
      }, this.timeout);

      this._pending.set(seq, { resolve, reject, timer });
      this._socket.send(buf, 0, buf.length, this.port, this.host, (err) => {
        if (err) {
          clearTimeout(timer);
          this._pending.delete(seq);
          reject(err);
        }
      });
    });
  }

  async read(itemType, address, count) {
    count = count || 1;
    const type = ITEM_TYPES[itemType];
    if (!type) {
      throw new Error(`Unknown item type: ${itemType}`);
    }
    if (!Number.isInteger(address) || address < 0) {
      throw new Error(`Invalid EtherSBus address: ${address}`);
    }
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`Invalid EtherSBus read count: ${count}`);
    }

    const maxReadCount = getMaxReadCount(type);
    const values = [];
    let nextAddress = address;
    let remaining = count;

    while (remaining > 0) {
      const chunkCount = Math.min(remaining, maxReadCount);
      const seq = this._nextSeq();
      const buf = buildReadRequest(
        seq,
        this.station,
        type.read,
        nextAddress,
        chunkCount,
      );
      const resp = await this._send(buf);
      const parsed = parseResponse(resp, type.binary, chunkCount);
      values.push(...parsed.values);
      nextAddress += chunkCount;
      remaining -= chunkCount;
    }

    return count === 1 ? values[0] : values;
  }

  async write(itemType, address, values) {
    if (!Array.isArray(values)) {
      values = [values];
    }

    const type = ITEM_TYPES[itemType];
    if (!type) {
      throw new Error(`Unknown item type: ${itemType}`);
    }
    if (!type.write) {
      throw new Error(`Item type ${itemType} is read-only`);
    }
    if (!Number.isInteger(address) || address < 0) {
      throw new Error(`Invalid EtherSBus address: ${address}`);
    }
    if (values.length < 1) {
      throw new Error("EtherSBus write requires at least one value");
    }

    const normalizedValues = type.binary
      ? values.map((value) => !!value)
      : values.map((value) => {
          if (!Number.isInteger(value)) {
            throw new Error(`Invalid 32-bit EtherSBus write value: ${value}`);
          }
          return value;
        });

    const maxWriteCount = getMaxWriteCount(type);
    let nextAddress = address;
    let offset = 0;

    while (offset < normalizedValues.length) {
      const chunk = normalizedValues.slice(offset, offset + maxWriteCount);
      const seq = this._nextSeq();
      const buf = buildWriteRequest(
        seq,
        this.station,
        type.write,
        nextAddress,
        chunk,
        type.binary,
      );
      const resp = await this._send(buf);
      const ack = parseAckResponse(resp);
      if (ack.frameType !== 0x02) {
        throw new Error(
          `Unexpected write response type: 0x${ack.frameType.toString(16).padStart(2, "0")}`,
        );
      }
      if (ack.code !== 0x0000) {
        throw new Error(
          `EtherSBus write not acknowledged: 0x${ack.code.toString(16).padStart(4, "0")}`,
        );
      }
      nextAddress += chunk.length;
      offset += chunk.length;
    }

    return true;
  }

  close() {
    try {
      this._socket.close();
    } catch (_) {}
  }
}

module.exports = { SBusClient, ITEM_TYPES, CMD };
