/**
 * The Content-Type header originates from the uploading browser and cannot be trusted.
 * Match only the formats explicitly allowed for MBotéRoom attachments.
 */
export function hasAllowedFileSignature(mime: string, input: Uint8Array): boolean {
  if (mime === 'application/pdf') {
    return input.length >= 5 && input[0] === 0x25 && input[1] === 0x50
      && input[2] === 0x44 && input[3] === 0x46 && input[4] === 0x2d; // %PDF-
  }
  if (mime === 'image/png') {
    const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return input.length >= header.length && header.every((value, index) => input[index] === value);
  }
  if (mime === 'image/jpeg') {
    return input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
  }
  if (mime === 'image/gif') {
    if (input.length < 6) return false;
    const header = String.fromCharCode(...input.subarray(0, 6));
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (mime === 'image/webp') {
    if (input.length < 12) return false;
    const fourCC = (start: number) => String.fromCharCode(...input.subarray(start, start + 4));
    return fourCC(0) === 'RIFF' && fourCC(8) === 'WEBP';
  }
  return false;
}
