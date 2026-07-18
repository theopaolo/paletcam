import { describe, expect, test } from "bun:test";
import { readBoundedRequestText, RequestBodyTooLargeError } from "./request-body.js";

function createChunkedRequest(chunks) {
  return new Request("https://logs.example/clientlog", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  });
}

describe("bounded request body", () => {
  test("reads a chunked UTF-8 body within the byte ceiling", async () => {
    const request = createChunkedRequest(['{"message":"', 'héllo"}']);
    expect(await readBoundedRequestText(request, 64)).toBe('{"message":"héllo"}');
  });

  test("rejects a chunked body immediately after it crosses the ceiling", async () => {
    const request = createChunkedRequest(["1234", "5678", "9"]);
    await expect(readBoundedRequestText(request, 8)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });
});
