import { Connection, PublicKey } from '@solana/web3.js'

export type IdlType =
  | string
  | { vec: IdlType }
  | { option: IdlType }
  | { array: [IdlType, number] }
  | { defined: string | { name: string } }
  | { kind?: string; fields?: IdlField[]; variants?: IdlEnumVariant[] }

export type IdlField = {
  name: string
  type: IdlType
}

export type IdlEnumVariant = {
  name: string
  fields?: IdlField[] | IdlType[]
}

export type IdlAccountInput = {
  name: string
  isMut?: boolean
  isSigner?: boolean
  writable?: boolean
  signer?: boolean
}

export type IdlInstruction = {
  name: string
  args: IdlField[]
  accounts: IdlAccountInput[]
  discriminator?: number[]
}

export type IdlTypeDef = {
  name: string
  type: {
    kind: 'struct' | 'enum' | string
    fields?: IdlField[]
    variants?: IdlEnumVariant[]
  }
}

export type Idl = {
  version?: string
  name?: string
  metadata?: { name?: string; version?: string; address?: string }
  instructions: IdlInstruction[]
  accounts?: { name: string; type?: any; discriminator?: number[] }[]
  types?: IdlTypeDef[]
  address?: string
}

export type DecodedArg = {
  name: string
  type: string
  value: string
}

export type IdlDecodedInstruction = {
  programLabel: string
  method: string
  args: DecodedArg[]
  accountRoles: string[]
  source: 'idl'
}

const ANCHOR_IDL_SEED = 'anchor:idl'

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return new Uint8Array(buf)
}

function toSnakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export async function getIdlAddress(programId: PublicKey): Promise<PublicKey> {
  const [base] = PublicKey.findProgramAddressSync([], programId)
  return await PublicKey.createWithSeed(base, ANCHOR_IDL_SEED, programId)
}

async function decompressDeflate(input: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate')
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

export async function fetchIdl(
  connection: Connection,
  programId: PublicKey,
): Promise<Idl | null> {
  const idlAddress = await getIdlAddress(programId)
  const info = await connection.getAccountInfo(idlAddress, 'confirmed')
  if (!info) return null

  const data = info.data
  // Layout: 8-byte account discriminator + 32-byte authority + 4-byte u32 LE length + N bytes zlib-compressed JSON
  if (data.length < 44) return null
  const dataLen =
    (data[40] |
      (data[41] << 8) |
      (data[42] << 16) |
      (data[43] << 24)) >>>
    0
  if (data.length < 44 + dataLen) return null

  const compressed = new Uint8Array(data.subarray(44, 44 + dataLen))

  let decompressed: Uint8Array
  try {
    decompressed = await decompressDeflate(compressed)
  } catch {
    // Try raw deflate as fallback
    try {
      const ds = new DecompressionStream('deflate-raw')
      const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(ds)
      const buf = await new Response(stream).arrayBuffer()
      decompressed = new Uint8Array(buf)
    } catch {
      return null
    }
  }

  const json = new TextDecoder().decode(decompressed)
  try {
    return JSON.parse(json) as Idl
  } catch {
    return null
  }
}

async function getInstructionDiscriminator(
  ix: IdlInstruction,
): Promise<Uint8Array> {
  if (ix.discriminator && ix.discriminator.length > 0) {
    return new Uint8Array(ix.discriminator)
  }
  const candidates = [ix.name, toSnakeCase(ix.name)]
  // Compute the legacy "global:<name>" hash for the snake_case form (most common)
  const seed = `global:${candidates[1]}`
  const hash = await sha256(new TextEncoder().encode(seed))
  return hash.subarray(0, 8)
}

class BorshReader {
  offset = 0
  data: Uint8Array

  constructor(data: Uint8Array) {
    this.data = data
  }

  remaining(): number {
    return this.data.length - this.offset
  }

  needs(n: number): void {
    if (this.remaining() < n) {
      throw new Error(`Borsh: need ${n} bytes, have ${this.remaining()}`)
    }
  }

  u8(): number {
    this.needs(1)
    return this.data[this.offset++]
  }
  i8(): number {
    const v = this.u8()
    return v > 127 ? v - 256 : v
  }
  u16(): number {
    this.needs(2)
    const v = this.data[this.offset] | (this.data[this.offset + 1] << 8)
    this.offset += 2
    return v
  }
  i16(): number {
    const v = this.u16()
    return v > 32767 ? v - 65536 : v
  }
  u32(): number {
    this.needs(4)
    const v =
      (this.data[this.offset] |
        (this.data[this.offset + 1] << 8) |
        (this.data[this.offset + 2] << 16) |
        (this.data[this.offset + 3] << 24)) >>>
      0
    this.offset += 4
    return v
  }
  i32(): number {
    const v = this.u32()
    return v > 0x7fffffff ? v - 0x100000000 : v
  }
  u64(): bigint {
    this.needs(8)
    let r = 0n
    for (let i = 0; i < 8; i++) {
      r |= BigInt(this.data[this.offset + i]) << BigInt(i * 8)
    }
    this.offset += 8
    return r
  }
  i64(): bigint {
    const v = this.u64()
    return v >= 1n << 63n ? v - (1n << 64n) : v
  }
  u128(): bigint {
    this.needs(16)
    let r = 0n
    for (let i = 0; i < 16; i++) {
      r |= BigInt(this.data[this.offset + i]) << BigInt(i * 8)
    }
    this.offset += 16
    return r
  }
  i128(): bigint {
    const v = this.u128()
    return v >= 1n << 127n ? v - (1n << 128n) : v
  }
  bool(): boolean {
    return this.u8() !== 0
  }
  string(): string {
    const len = this.u32()
    this.needs(len)
    const out = new TextDecoder().decode(
      this.data.subarray(this.offset, this.offset + len),
    )
    this.offset += len
    return out
  }
  bytes(): Uint8Array {
    const len = this.u32()
    this.needs(len)
    const out = this.data.subarray(this.offset, this.offset + len)
    this.offset += len
    return new Uint8Array(out)
  }
  publicKey(): string {
    this.needs(32)
    const slice = this.data.subarray(this.offset, this.offset + 32)
    this.offset += 32
    return new PublicKey(slice).toBase58()
  }
}

class BorshWriter {
  bytes: number[] = []

  u8(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 0xff) {
      throw new Error(`u8 out of range: ${v}`)
    }
    this.bytes.push(v)
  }
  i8(v: number): void {
    if (!Number.isInteger(v) || v < -128 || v > 127) {
      throw new Error(`i8 out of range: ${v}`)
    }
    this.bytes.push(v < 0 ? v + 256 : v)
  }
  u16(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) {
      throw new Error(`u16 out of range: ${v}`)
    }
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff)
  }
  i16(v: number): void {
    if (!Number.isInteger(v) || v < -32768 || v > 32767) {
      throw new Error(`i16 out of range: ${v}`)
    }
    const u = v < 0 ? v + 0x10000 : v
    this.bytes.push(u & 0xff, (u >>> 8) & 0xff)
  }
  u32(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
      throw new Error(`u32 out of range: ${v}`)
    }
    this.bytes.push(
      v & 0xff,
      (v >>> 8) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 24) & 0xff,
    )
  }
  i32(v: number): void {
    if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) {
      throw new Error(`i32 out of range: ${v}`)
    }
    const u = v < 0 ? v + 0x100000000 : v
    this.bytes.push(
      u & 0xff,
      (u >>> 8) & 0xff,
      (u >>> 16) & 0xff,
      (u >>> 24) & 0xff,
    )
  }
  u64(v: bigint): void {
    if (v < 0n || v > 0xffffffffffffffffn) {
      throw new Error(`u64 out of range: ${v}`)
    }
    for (let i = 0; i < 8; i++) {
      this.bytes.push(Number((v >> BigInt(i * 8)) & 0xffn))
    }
  }
  i64(v: bigint): void {
    if (v < -(1n << 63n) || v >= 1n << 63n) {
      throw new Error(`i64 out of range: ${v}`)
    }
    const u = v < 0n ? v + (1n << 64n) : v
    for (let i = 0; i < 8; i++) {
      this.bytes.push(Number((u >> BigInt(i * 8)) & 0xffn))
    }
  }
  u128(v: bigint): void {
    if (v < 0n || v >= 1n << 128n) {
      throw new Error(`u128 out of range: ${v}`)
    }
    for (let i = 0; i < 16; i++) {
      this.bytes.push(Number((v >> BigInt(i * 8)) & 0xffn))
    }
  }
  i128(v: bigint): void {
    if (v < -(1n << 127n) || v >= 1n << 127n) {
      throw new Error(`i128 out of range: ${v}`)
    }
    const u = v < 0n ? v + (1n << 128n) : v
    for (let i = 0; i < 16; i++) {
      this.bytes.push(Number((u >> BigInt(i * 8)) & 0xffn))
    }
  }
  bool(v: boolean): void {
    this.bytes.push(v ? 1 : 0)
  }
  string(v: string): void {
    const enc = new TextEncoder().encode(v)
    this.u32(enc.length)
    for (const b of enc) this.bytes.push(b)
  }
  rawBytes(v: Uint8Array): void {
    for (const b of v) this.bytes.push(b)
  }
  bytes_(v: Uint8Array): void {
    this.u32(v.length)
    this.rawBytes(v)
  }
  publicKey(pk: string): void {
    const k = new PublicKey(pk).toBytes()
    for (const b of k) this.bytes.push(b)
  }
  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

const PRIMITIVE_IDL_TYPES = new Set([
  'bool',
  'u8',
  'i8',
  'u16',
  'i16',
  'u32',
  'i32',
  'u64',
  'i64',
  'u128',
  'i128',
  'string',
  'bytes',
  'publicKey',
  'pubkey',
])

export function isPrimitiveIdlType(t: IdlType): boolean {
  return typeof t === 'string' && PRIMITIVE_IDL_TYPES.has(t)
}

function parseHexBytes(s: string): Uint8Array {
  const cleaned = s.trim().replace(/^0x/i, '').replace(/\s+/g, '')
  if (cleaned.length === 0) return new Uint8Array(0)
  if (cleaned.length % 2 !== 0) {
    throw new Error('hex must have even number of digits')
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('hex contains non-hex characters')
  }
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function writePrimitive(
  writer: BorshWriter,
  type: string,
  value: string,
): void {
  const v = value.trim()
  switch (type) {
    case 'bool': {
      const lower = v.toLowerCase()
      if (lower === 'true' || lower === '1') writer.bool(true)
      else if (lower === 'false' || lower === '0') writer.bool(false)
      else throw new Error(`bool must be true/false, got "${v}"`)
      return
    }
    case 'u8': writer.u8(Number(v)); return
    case 'i8': writer.i8(Number(v)); return
    case 'u16': writer.u16(Number(v)); return
    case 'i16': writer.i16(Number(v)); return
    case 'u32': writer.u32(Number(v)); return
    case 'i32': writer.i32(Number(v)); return
    case 'u64': writer.u64(BigInt(v)); return
    case 'i64': writer.i64(BigInt(v)); return
    case 'u128': writer.u128(BigInt(v)); return
    case 'i128': writer.i128(BigInt(v)); return
    case 'string': {
      // Accept JSON-quoted ("foo") or raw (foo). If starts and ends with quote, parse as JSON.
      let raw = v
      if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        try {
          raw = JSON.parse(raw)
        } catch {
          // fall through, use as-is minus the quotes
          raw = v.slice(1, -1)
        }
      }
      writer.string(raw)
      return
    }
    case 'bytes': {
      writer.bytes_(parseHexBytes(v))
      return
    }
    case 'publicKey':
    case 'pubkey':
      writer.publicKey(v)
      return
  }
  throw new Error(`writePrimitive: unknown type ${type}`)
}

export function encodeIdlInstructionData(args: {
  discriminator: Uint8Array
  argSpec: { name: string; type: IdlType }[]
  argValues: { name: string; value: string }[]
}): Uint8Array {
  const writer = new BorshWriter()
  writer.rawBytes(args.discriminator)

  for (const spec of args.argSpec) {
    if (!isPrimitiveIdlType(spec.type)) {
      throw new Error(
        `Cannot encode arg "${spec.name}" of type ${typeName(spec.type)}: ` +
          `only primitive Borsh types are editable for now (bool, integers, string, bytes, publicKey).`,
      )
    }
    const found = args.argValues.find((a) => a.name === spec.name)
    if (!found) {
      throw new Error(`Missing value for arg "${spec.name}"`)
    }
    try {
      writePrimitive(writer, spec.type as string, found.value)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      throw new Error(`Arg "${spec.name}" (${spec.type}): ${msg}`)
    }
  }

  return writer.toBytes()
}

export async function getInstructionDiscriminatorFor(
  ix: IdlInstruction,
): Promise<Uint8Array> {
  return getInstructionDiscriminator(ix)
}

function typeName(t: IdlType): string {
  if (typeof t === 'string') return t
  if ('vec' in t) return `Vec<${typeName(t.vec)}>`
  if ('option' in t) return `Option<${typeName(t.option)}>`
  if ('array' in t) return `[${typeName(t.array[0])}; ${t.array[1]}]`
  if ('defined' in t) {
    const d = t.defined
    return typeof d === 'string' ? d : d.name
  }
  if ('kind' in t) return String(t.kind)
  return 'unknown'
}

function definedName(t: IdlType): string | null {
  if (typeof t !== 'object') return null
  if ('defined' in t) {
    const d = t.defined
    return typeof d === 'string' ? d : d.name
  }
  return null
}

function readPrimitive(
  reader: BorshReader,
  t: string,
): string | null {
  switch (t) {
    case 'bool':
      return String(reader.bool())
    case 'u8':
      return String(reader.u8())
    case 'i8':
      return String(reader.i8())
    case 'u16':
      return String(reader.u16())
    case 'i16':
      return String(reader.i16())
    case 'u32':
      return String(reader.u32())
    case 'i32':
      return String(reader.i32())
    case 'u64':
      return reader.u64().toString()
    case 'i64':
      return reader.i64().toString()
    case 'u128':
      return reader.u128().toString()
    case 'i128':
      return reader.i128().toString()
    case 'string':
      return JSON.stringify(reader.string())
    case 'bytes': {
      const b = reader.bytes()
      return `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
    }
    case 'publicKey':
    case 'pubkey':
      return reader.publicKey()
  }
  return null
}

function decodeArg(
  reader: BorshReader,
  type: IdlType,
  idl: Idl,
  depth = 0,
): string {
  if (depth > 10) return '<too deeply nested>'

  if (typeof type === 'string') {
    const v = readPrimitive(reader, type)
    if (v !== null) return v
    return `<unknown primitive ${type}>`
  }

  if ('option' in type) {
    const tag = reader.u8()
    if (tag === 0) return 'None'
    return `Some(${decodeArg(reader, type.option, idl, depth + 1)})`
  }

  if ('vec' in type) {
    const len = reader.u32()
    const out: string[] = []
    for (let i = 0; i < len; i++) {
      out.push(decodeArg(reader, type.vec, idl, depth + 1))
    }
    return `[${out.join(', ')}]`
  }

  if ('array' in type) {
    const [inner, n] = type.array
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      out.push(decodeArg(reader, inner, idl, depth + 1))
    }
    return `[${out.join(', ')}]`
  }

  const dname = definedName(type)
  if (dname) {
    const def = (idl.types ?? []).find((t) => t.name === dname)
    if (!def) return `<unknown type ${dname}>`
    if (def.type.kind === 'struct') {
      const fields = def.type.fields ?? []
      const parts: string[] = []
      for (const f of fields) {
        parts.push(`${f.name}: ${decodeArg(reader, f.type, idl, depth + 1)}`)
      }
      return `{ ${parts.join(', ')} }`
    }
    if (def.type.kind === 'enum') {
      const variantIdx = reader.u8()
      const variants = def.type.variants ?? []
      const v = variants[variantIdx]
      if (!v) return `<enum tag ${variantIdx}>`
      if (!v.fields || v.fields.length === 0) return v.name
      const parts: string[] = []
      for (const f of v.fields as IdlField[]) {
        parts.push(`${f.name}: ${decodeArg(reader, f.type, idl, depth + 1)}`)
      }
      return `${v.name} { ${parts.join(', ')} }`
    }
    return `<${dname}>`
  }

  return `<${typeName(type)}>`
}

export async function decodeInstructionWithIdl(
  idl: Idl,
  data: Uint8Array,
  accounts: string[],
): Promise<IdlDecodedInstruction | null> {
  for (const ix of idl.instructions) {
    let disc: Uint8Array
    try {
      disc = await getInstructionDiscriminator(ix)
    } catch {
      continue
    }
    if (data.length < disc.length) continue
    if (!bytesEqual(data.subarray(0, disc.length), disc)) continue

    const reader = new BorshReader(new Uint8Array(data.subarray(disc.length)))
    const decodedArgs: DecodedArg[] = []
    try {
      for (const arg of ix.args) {
        const value = decodeArg(reader, arg.type, idl)
        decodedArgs.push({
          name: arg.name,
          type: typeName(arg.type),
          value,
        })
      }
    } catch (e) {
      decodedArgs.push({
        name: '_decode_error',
        type: 'error',
        value: e instanceof Error ? e.message : 'unknown',
      })
    }

    const accountRoles = ix.accounts
      .slice(0, accounts.length)
      .map((a) => a.name)

    return {
      programLabel:
        idl.metadata?.name ?? idl.name ?? 'Anchor program',
      method: ix.name,
      args: decodedArgs,
      accountRoles,
      source: 'idl',
    }
  }
  return null
}

export async function fetchAndDecodeWithIdls(
  connection: Connection,
  items: { programId: string; data: Uint8Array; accounts: string[] }[],
): Promise<{
  idlsByProgram: Map<string, Idl | null>
  decodedByIndex: Map<number, IdlDecodedInstruction>
}> {
  const idlsByProgram = new Map<string, Idl | null>()
  const decodedByIndex = new Map<number, IdlDecodedInstruction>()

  const uniqueProgramIds = new Set<string>()
  for (const it of items) {
    if (it.programId.startsWith('lookup:')) continue
    uniqueProgramIds.add(it.programId)
  }

  for (const programId of uniqueProgramIds) {
    try {
      const pk = new PublicKey(programId)
      const idl = await fetchIdl(connection, pk)
      idlsByProgram.set(programId, idl)
    } catch {
      idlsByProgram.set(programId, null)
    }
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const idl = idlsByProgram.get(it.programId)
    if (!idl) continue
    const decoded = await decodeInstructionWithIdl(idl, it.data, it.accounts)
    if (decoded) decodedByIndex.set(i, decoded)
  }

  return { idlsByProgram, decodedByIndex }
}
