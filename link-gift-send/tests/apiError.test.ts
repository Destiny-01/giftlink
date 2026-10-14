/**
 * Runtime tests for API error normalization.
 *
 * The backend answers with a nested envelope: `{ error: { message, statusCode, code } }`. The old
 * parser read `data.error` (an object) as the message, so toasts showed "[object Object]" and
 * `ApiError.code` was always undefined — which is why Studio's `issuer_not_allowlisted` /
 * `campaign_cap_exceeded` handling could never fire.
 *
 * Node has a global `Response`, so the real parser runs against real responses here.
 *
 * Run with: npm test  (node --test, TypeScript stripped natively)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseErrorResponse } from "../src/lib/utils.ts";

function jsonResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("reads the nested backend envelope with its code", async () => {
  const error = await parseErrorResponse(
    jsonResponse(
      { error: { message: "Issuer is not allowlisted", statusCode: 403, code: "issuer_not_allowlisted" } },
      403
    )
  );
  assert.equal(error.message, "Issuer is not allowlisted");
  assert.equal(error.code, "issuer_not_allowlisted");
  assert.equal(error.statusCode, 403);
});

test("reads the nested envelope when code is absent", async () => {
  const error = await parseErrorResponse(
    jsonResponse({ error: { message: "Campaign cap exceeded" } })
  );
  assert.equal(error.message, "Campaign cap exceeded");
  assert.equal(error.code, undefined);
});

test("supports a legacy string error field", async () => {
  const error = await parseErrorResponse(jsonResponse({ error: "Boom" }, 500));
  assert.equal(error.message, "Boom");
});

test("a flat body with message and code is still read", async () => {
  const error = await parseErrorResponse(
    jsonResponse({ message: "Bad request", code: "campaign_cap_exceeded" }, 400)
  );
  assert.equal(error.message, "Bad request");
  assert.equal(error.code, "campaign_cap_exceeded");
});

test("falls back to status text for a non-JSON body", async () => {
  const response = new Response("not json", {
    status: 502,
    statusText: "Bad Gateway",
  });
  const error = await parseErrorResponse(response);
  assert.equal(error.message, "Bad Gateway");
  assert.equal(error.statusCode, 502);
});
