# Palette metadata in exported images

Every image Color Catchers exports carries its palette as an XMP packet, so a
consuming application reads the colors from the file instead of sampling pixels.

The app only ever **writes** the packet — it never reads one back. Producer:
`src/modules/collection/palette-image-metadata.js`.

## Where the packet lives

| Export | MIME | Carrier |
| --- | --- | --- |
| Polaroid front (download and share) | `image/webp`, `image/jpeg` fallback | WebP `XMP ` chunk (the file is promoted to the extended `VP8X` form), or a JPEG `APP1` segment |
| Verso plate | `image/png` | PNG `iTXt` chunk, keyword `XML:com.adobe.xmp` |

Stored gallery and viewer previews carry no packet: they never leave the device
and are re-rendered from the record.

## Payload

The packet is a standard XMP wrapper holding one element, `cc:palette`, in the
`https://colorcatchers.co/ns/palette/1.0/` namespace. Its text is a JSON array
of hex colors, so a reader can extract and `JSON.parse` it without walking RDF.

```xml
<cc:palette>["#06091F","#032662","#0048B8"]</cc:palette>
```

- Uppercase sRGB, always six digits with a leading `#`.
- Colors keep the palette order shown in the app.
- Nothing else is embedded — no capture date, no location, no identifier — so a
  shared export leaks nothing beyond its colors.
- The format version lives in the namespace URI. A reader that wants to guard
  against a future change should match on `palette/1.0/` rather than expect a
  version field inside the payload.

## Reading it

```js
async function readPaletteFromImage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(bytes);

  const open = "<cc:palette>";
  const start = text.indexOf(open);
  const end = text.indexOf("</cc:palette>");
  if (start < 0 || end <= start) return null;

  return JSON.parse(
    text
      .slice(start + open.length, end)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}
```

That scan is enough for a consumer. Walking the container properly — JPEG
segments, PNG chunks, or RIFF chunks — is only worth it if the reader must
reject files where the string appears somewhere other than a metadata block.

Hex is sRGB. Convert to OKLab in the consumer when interpolating gradients;
mixing in sRGB is what produces muddy midpoints.

## What survives transport

A packet survives AirDrop, Files, a mail attachment, a direct download, and
Photos. It does **not** survive an app that re-encodes on upload — Messages,
WhatsApp, Instagram, Discord and most social platforms strip metadata. Move the
file as a file when the colors have to travel with it.
