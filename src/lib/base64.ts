const BASE64_STRIP_RE = /[\r\n\s]/g

function normalizeBase64(input: string): string {
  let s = input.trim().replace(BASE64_STRIP_RE, '')
  // Allow URL-safe base64 variants.
  s = s.replace(/-/g, '+').replace(/_/g, '/')

  // Add missing padding if needed.
  const remainder = s.length % 4
  if (remainder === 2) s += '=='
  else if (remainder === 3) s += '='
  else if (remainder === 1) {
    throw new Error('Invalid base64 length (mod 4 = 1).')
  }

  return s
}

export function base64ToBytes(input: string): Uint8Array {
  const normalized = normalizeBase64(input)
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Convert bytes -> binary string in chunks to avoid call stack issues.
  let binary = ''
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    let chunkStr = ''
    for (let j = 0; j < chunk.length; j++) {
      chunkStr += String.fromCharCode(chunk[j])
    }
    binary += chunkStr
  }

  return btoa(binary)
}

