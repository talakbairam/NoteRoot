<#
.SYNOPSIS
Opens a repository that NoteRoot encrypted (Sync with encryption), without the extension and without Node.js.

.DESCRIPTION
Works in Windows PowerShell 5.1 and PowerShell 7. Clone the repository first (git clone ...), or download it as a ZIP and
unpack it. The script asks for the master key (hidden), opens every note and writes it, with its own name and folders, into
the output folder. It never overwrites a file.

  .\decrypt-repo.ps1 <folder of the repository> <output folder>

If scripts are blocked on your computer, run it like this:
  powershell -ExecutionPolicy Bypass -File .\decrypt-repo.ps1 <folder of the repository> <output folder>

Format (it must stay in step with src/services/SyncCrypto.ts and decrypt-repo.js):
  .noteroot-encrypted  JSON: { format: 1, names: "plain" | "hidden", salt: base64 (16 bytes), check: base64 }
  .noteroot-index      sealed JSON: { format: 1, files: { "<path>": { name: "<file online>", hash: "<sha256 of the note>" } } }
  every sealed file    "NRS1" + iv (12) + tag (16) + AES-256-GCM data; the authenticated data is the path of the note
                      (".noteroot-index" for the index, "check" for the check text)
  key                  scrypt(master key in Unicode NFC, salt, N=32768, r=8, p=1, 32 bytes)
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Repository,
  [Parameter(Mandatory = $true, Position = 1)][string]$OutputFolder
)

$ErrorActionPreference = 'Stop'

# scrypt and AES-GCM are not in .NET Framework, so they are written here (C# 5, for the 5.1 compiler).
$source = @'
using System;
using System.Security.Cryptography;

public static class NoteRootCrypto
{
    private static uint Rotl(uint a, int b) { return (a << b) | (a >> (32 - b)); }

    // Salsa20/8 core (RFC 7914), in place on 16 words.
    private static void Salsa8(uint[] b)
    {
        uint[] x = (uint[])b.Clone();
        for (int i = 0; i < 8; i += 2)
        {
            x[4] ^= Rotl(x[0] + x[12], 7);  x[8] ^= Rotl(x[4] + x[0], 9);
            x[12] ^= Rotl(x[8] + x[4], 13); x[0] ^= Rotl(x[12] + x[8], 18);
            x[9] ^= Rotl(x[5] + x[1], 7);   x[13] ^= Rotl(x[9] + x[5], 9);
            x[1] ^= Rotl(x[13] + x[9], 13); x[5] ^= Rotl(x[1] + x[13], 18);
            x[14] ^= Rotl(x[10] + x[6], 7); x[2] ^= Rotl(x[14] + x[10], 9);
            x[6] ^= Rotl(x[2] + x[14], 13); x[10] ^= Rotl(x[6] + x[2], 18);
            x[3] ^= Rotl(x[15] + x[11], 7); x[7] ^= Rotl(x[3] + x[15], 9);
            x[11] ^= Rotl(x[7] + x[3], 13); x[15] ^= Rotl(x[11] + x[7], 18);
            x[1] ^= Rotl(x[0] + x[3], 7);   x[2] ^= Rotl(x[1] + x[0], 9);
            x[3] ^= Rotl(x[2] + x[1], 13);  x[0] ^= Rotl(x[3] + x[2], 18);
            x[6] ^= Rotl(x[5] + x[4], 7);   x[7] ^= Rotl(x[6] + x[5], 9);
            x[4] ^= Rotl(x[7] + x[6], 13);  x[5] ^= Rotl(x[4] + x[7], 18);
            x[11] ^= Rotl(x[10] + x[9], 7); x[8] ^= Rotl(x[11] + x[10], 9);
            x[9] ^= Rotl(x[8] + x[11], 13); x[10] ^= Rotl(x[9] + x[8], 18);
            x[12] ^= Rotl(x[15] + x[14], 7); x[13] ^= Rotl(x[12] + x[15], 9);
            x[14] ^= Rotl(x[13] + x[12], 13); x[15] ^= Rotl(x[14] + x[13], 18);
        }
        for (int i = 0; i < 16; i++) { b[i] += x[i]; }
    }

    private static void BlockMix(uint[] b, uint[] y, int r)
    {
        uint[] x = new uint[16];
        Array.Copy(b, (2 * r - 1) * 16, x, 0, 16);
        for (int i = 0; i < 2 * r; i++)
        {
            for (int k = 0; k < 16; k++) { x[k] ^= b[i * 16 + k]; }
            Salsa8(x);
            int dest = (i % 2 == 0) ? (i / 2) : (r + i / 2);
            Array.Copy(x, 0, y, dest * 16, 16);
        }
        Array.Copy(y, b, b.Length);
    }

    // PBKDF2-HMAC-SHA256 with one iteration, which is all scrypt needs.
    private static byte[] Pbkdf2One(byte[] password, byte[] salt, int length)
    {
        byte[] result = new byte[length];
        using (HMACSHA256 hmac = new HMACSHA256(password))
        {
            int pos = 0;
            for (uint block = 1; pos < length; block++)
            {
                byte[] input = new byte[salt.Length + 4];
                Array.Copy(salt, input, salt.Length);
                input[salt.Length] = (byte)(block >> 24);
                input[salt.Length + 1] = (byte)(block >> 16);
                input[salt.Length + 2] = (byte)(block >> 8);
                input[salt.Length + 3] = (byte)block;
                byte[] t = hmac.ComputeHash(input);
                int n = Math.Min(t.Length, length - pos);
                Array.Copy(t, 0, result, pos, n);
                pos += n;
            }
        }
        return result;
    }

    public static byte[] Scrypt(byte[] password, byte[] salt, int n, int r, int dkLen)
    {
        byte[] bytes = Pbkdf2One(password, salt, 128 * r);
        int words = 32 * r;
        uint[] x = new uint[words];
        for (int i = 0; i < words; i++) { x[i] = BitConverter.ToUInt32(bytes, i * 4); }
        uint[] v = new uint[(long)n * words];
        uint[] y = new uint[words];
        for (int i = 0; i < n; i++)
        {
            Array.Copy(x, 0, v, (long)i * words, words);
            BlockMix(x, y, r);
        }
        for (int i = 0; i < n; i++)
        {
            long j = x[(2 * r - 1) * 16] & (uint)(n - 1);
            for (int k = 0; k < words; k++) { x[k] ^= v[j * words + k]; }
            BlockMix(x, y, r);
        }
        for (int i = 0; i < words; i++)
        {
            byte[] w = BitConverter.GetBytes(x[i]);
            Array.Copy(w, 0, bytes, i * 4, 4);
        }
        return Pbkdf2One(password, bytes, dkLen);
    }

    // GF(2^128) multiplication of GCM: x = x * h. Both are two big-endian 64-bit halves.
    private static void Multiply(ulong[] x, ulong[] h)
    {
        ulong zh = 0, zl = 0, vh = h[0], vl = h[1];
        for (int i = 0; i < 128; i++)
        {
            ulong bit = (i < 64) ? (x[0] >> (63 - i)) & 1UL : (x[1] >> (127 - i)) & 1UL;
            if (bit == 1UL) { zh ^= vh; zl ^= vl; }
            ulong lsb = vl & 1UL;
            vl = (vl >> 1) | (vh << 63);
            vh >>= 1;
            if (lsb == 1UL) { vh ^= 0xE100000000000000UL; }
        }
        x[0] = zh; x[1] = zl;
    }

    private static ulong ReadBe(byte[] data, int offset, int count)
    {
        ulong value = 0;
        for (int i = 0; i < 8; i++)
        {
            value <<= 8;
            if (i < count) { value |= data[offset + i]; }
        }
        return value;
    }

    private static void GhashUpdate(ulong[] y, ulong[] h, byte[] data)
    {
        for (int offset = 0; offset < data.Length; offset += 16)
        {
            int count = Math.Min(16, data.Length - offset);
            y[0] ^= ReadBe(data, offset, Math.Min(8, count));
            y[1] ^= ReadBe(data, offset + 8, Math.Max(0, count - 8));
            Multiply(y, h);
        }
    }

    // Returns the plain text, or throws CryptographicException when the key is wrong or the file is damaged.
    public static byte[] Decrypt(byte[] key, byte[] iv, byte[] tag, byte[] body, byte[] aad)
    {
        using (Aes aes = Aes.Create())
        {
            aes.Key = key;
            aes.Mode = CipherMode.ECB;
            aes.Padding = PaddingMode.None;
            using (ICryptoTransform enc = aes.CreateEncryptor())
            {
                byte[] zero = new byte[16];
                byte[] hb = new byte[16];
                enc.TransformBlock(zero, 0, 16, hb, 0);
                ulong[] h = new ulong[] { ReadBe(hb, 0, 8), ReadBe(hb, 8, 8) };

                ulong[] y = new ulong[2];
                GhashUpdate(y, h, aad);
                GhashUpdate(y, h, body);
                y[0] ^= (ulong)aad.Length * 8UL;
                y[1] ^= (ulong)body.Length * 8UL;
                Multiply(y, h);

                byte[] counter = new byte[16];
                Array.Copy(iv, counter, 12);
                counter[15] = 1;
                byte[] mask = new byte[16];
                enc.TransformBlock(counter, 0, 16, mask, 0);
                byte[] expected = new byte[16];
                for (int i = 0; i < 8; i++)
                {
                    expected[i] = (byte)((y[0] >> (56 - 8 * i)) ^ mask[i]);
                    expected[8 + i] = (byte)((y[1] >> (56 - 8 * i)) ^ mask[8 + i]);
                }
                int diff = 0;
                for (int i = 0; i < 16; i++) { diff |= expected[i] ^ tag[i]; }
                if (diff != 0) { throw new CryptographicException("Authentication failed."); }

                byte[] plain = new byte[body.Length];
                uint block = 2;
                for (int offset = 0; offset < body.Length; offset += 16)
                {
                    counter[12] = (byte)(block >> 24);
                    counter[13] = (byte)(block >> 16);
                    counter[14] = (byte)(block >> 8);
                    counter[15] = (byte)block;
                    enc.TransformBlock(counter, 0, 16, mask, 0);
                    int n = Math.Min(16, body.Length - offset);
                    for (int i = 0; i < n; i++) { plain[offset + i] = (byte)(body[offset + i] ^ mask[i]); }
                    block++;
                }
                return plain;
            }
        }
    }
}
'@

function Fail([string]$message) {
  [Console]::Error.WriteLine($message)
  exit 1
}

# A path from the index is data from outside: no empty part, "." or "..", no absolute path, no backslash.
function Test-Safe([string]$relative) {
  if ([string]::IsNullOrEmpty($relative) -or $relative.StartsWith('/') -or $relative.Contains('\')) {
    return $false
  }
  foreach ($part in $relative.Split('/')) {
    if ($part -eq '' -or $part -eq '.' -or $part -eq '..') {
      return $false
    }
  }
  return $true
}

$repositoryPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Repository)
$outputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputFolder)
$headerPath = [System.IO.Path]::Combine($repositoryPath, '.noteroot-encrypted')
if (-not [System.IO.File]::Exists($headerPath)) {
  Fail 'This folder has no .noteroot-encrypted file: it is not an encrypted NoteRoot repository.'
}
$header = [System.IO.File]::ReadAllText($headerPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
if ($header.format -ne 1) {
  Fail 'This repository was made by a newer version of NoteRoot.'
}

if (-not ('NoteRootCrypto' -as [type])) {
  Add-Type -TypeDefinition $source -Language CSharp
}

$secure = Read-Host -AsSecureString -Prompt 'Master key'
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $masterKey = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
$salt = [Convert]::FromBase64String($header.salt)
$password = [System.Text.Encoding]::UTF8.GetBytes($masterKey.Normalize([System.Text.NormalizationForm]::FormC))
$key = [NoteRootCrypto]::Scrypt($password, $salt, 32768, 8, 32)

# Opens a sealed file: the magic NRS1, the iv, the tag and the data. Throws when the key is wrong or the file was changed.
function Open-Sealed([byte[]]$sealed, [string]$aad) {
  if ($sealed.Length -lt 32 -or $sealed[0] -ne 78 -or $sealed[1] -ne 82 -or $sealed[2] -ne 83 -or $sealed[3] -ne 49) {
    throw 'not a sealed file'
  }
  $iv = New-Object byte[] 12
  $tag = New-Object byte[] 16
  $body = New-Object byte[] ($sealed.Length - 32)
  [Array]::Copy($sealed, 4, $iv, 0, 12)
  [Array]::Copy($sealed, 16, $tag, 0, 16)
  [Array]::Copy($sealed, 32, $body, 0, $body.Length)
  return [NoteRootCrypto]::Decrypt($key, $iv, $tag, $body, [System.Text.Encoding]::UTF8.GetBytes($aad))
}

try {
  $check = [System.Text.Encoding]::UTF8.GetString((Open-Sealed ([Convert]::FromBase64String($header.check)) 'check'))
  if ($check -ne 'NoteRoot') { throw 'wrong' }
} catch {
  Fail 'Wrong master key.'
}

$files = @()
$indexPath = [System.IO.Path]::Combine($repositoryPath, '.noteroot-index')
if ([System.IO.File]::Exists($indexPath)) {
  $indexText = [System.Text.Encoding]::UTF8.GetString((Open-Sealed ([System.IO.File]::ReadAllBytes($indexPath)) '.noteroot-index'))
  $files = @(($indexText | ConvertFrom-Json).files.PSObject.Properties)
}

$sha = [System.Security.Cryptography.SHA256]::Create()
$written = 0
foreach ($property in $files) {
  $relative = $property.Name
  $entry = $property.Value
  if (-not (Test-Safe $relative) -or -not (Test-Safe $entry.name)) {
    [Console]::Error.WriteLine("Skipped $($relative): the name is not safe.")
    continue
  }
  $sealedPath = [System.IO.Path]::Combine($repositoryPath, $entry.name.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
  try {
    $plain = Open-Sealed ([System.IO.File]::ReadAllBytes($sealedPath)) $relative
  } catch {
    [Console]::Error.WriteLine("Skipped $($relative): its file is missing, damaged or was changed.")
    continue
  }
  $hash = (($sha.ComputeHash($plain) | ForEach-Object { $_.ToString('x2') }) -join '')
  if ($hash -ne $entry.hash) {
    [Console]::Error.WriteLine("Skipped $($relative): the content does not match its hash.")
    continue
  }
  $target = [System.IO.Path]::Combine($outputPath, $relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
  if ([System.IO.File]::Exists($target)) {
    [Console]::Error.WriteLine("Skipped $($relative): the output file exists already.")
    continue
  }
  $stream = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew) # Never overwrites an existing file.
  try {
    $stream.Write($plain, 0, $plain.Length)
  } finally {
    $stream.Dispose()
  }
  $written++
}
[Console]::Error.WriteLine("$written notes written to $OutputFolder")
