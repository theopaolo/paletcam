import { describe, expect, mock, test } from "bun:test";
import { blobToBase64 } from "./blob-base64.js";

describe("blobToBase64", () => {
  test("uses the asynchronous native data-URL path when available", async () => {
    const arrayBuffer = mock(async () => {
      throw new Error("fallback must not run");
    });
    class FakeFileReader {
      readAsDataURL(blob) {
        expect(blob.arrayBuffer).toBe(arrayBuffer);
        this.result = "data:image/webp;base64,AQID";
        queueMicrotask(() => this.onload());
      }
    }

    const encoded = await blobToBase64(
      /** @type {Blob} */ ({ arrayBuffer }),
      /** @type {object} */ ({ FileReaderCtor: FakeFileReader }),
    );

    expect(encoded).toBe("AQID");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  test("rejects a native reader failure", async () => {
    const readError = new Error("read failed");
    class FailingFileReader {
      error = readError;

      readAsDataURL() {
        queueMicrotask(() => this.onerror());
      }
    }

    await expect(
      blobToBase64(new Blob(["photo"]), {
        FileReaderCtor: /** @type {typeof FileReader} */ (FailingFileReader),
      }),
    ).rejects.toBe(readError);
  });

  test("encodes in bounded binary chunks when FileReader is unavailable", async () => {
    const bytes = new Uint8Array(70_000);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }

    const encoded = await blobToBase64(new Blob([bytes]), { FileReaderCtor: undefined });
    const decoded = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));

    expect(decoded).toEqual(bytes);
  });
});
