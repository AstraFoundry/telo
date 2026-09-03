import {
  hostname,
  release,
  type as osType,
  version as osVersion,
} from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

function asciiHeaderValue(value: string, fallback = "unknown"): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return /^[\x20-\x7E]*$/.test(trimmed) ? trimmed : fallback;
}

function deviceModel(): string {
  const system = osType();
  return asciiHeaderValue(`${system} ${release()}`.trim());
}

export function kimiDeviceHeaders(input: {
  readonly deviceId: string;
  readonly appVersion: string;
}): Record<string, string> {
  return {
    "X-Msh-Platform": "telo",
    "X-Msh-Version": asciiHeaderValue(input.appVersion, "0"),
    "X-Msh-Device-Name": asciiHeaderValue(hostname()),
    "X-Msh-Device-Model": deviceModel(),
    "X-Msh-Os-Version": asciiHeaderValue(osVersion()),
    "X-Msh-Device-Id": asciiHeaderValue(input.deviceId),
  };
}

export function loadOrCreateKimiDeviceId(filePath: string): string {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8").trim();
    if (existing) return existing;
  }
  const id = randomUUID();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, id, { encoding: "utf8", mode: 0o600 });
  return id;
}
