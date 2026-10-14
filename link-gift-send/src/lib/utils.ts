import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize API errors to a consistent format
 */
export class ApiError extends Error {
  // Declared as plain fields rather than constructor parameter properties: the latter are
  // TypeScript-only syntax that the `node --test` strip-only loader rejects, which would make this
  // module unimportable from a test.
  statusCode?: number;
  code?: string;
  details?: unknown;

  constructor(
    message: string,
    statusCode?: number,
    code?: string,
    details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * Normalize fetch errors to ApiError
 */
export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    return new ApiError(error.message);
  }

  return new ApiError("An unknown error occurred");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parse API error response
 */
export async function parseErrorResponse(
  response: Response
): Promise<ApiError> {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const data = (await response.json()) as unknown;
    const record =
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : undefined;
    // The backend nests its error envelope as { error: { message, statusCode, code } }; a string
    // `error` is the legacy shape and some endpoints answer with a flat body. Read the nested
    // object first, then fall back, so a message is never a raw object and `code` is never lost.
    const nested =
      record && typeof record.error === "object" && record.error !== null
        ? (record.error as Record<string, unknown>)
        : undefined;

    const message =
      readString(nested?.message) ||
      readString(record?.message) ||
      readString(record?.error) ||
      fallback;
    const code = readString(nested?.code) ?? readString(record?.code);
    const details = nested?.details ?? record?.details ?? data;

    return new ApiError(message, response.status, code, details);
  } catch {
    // If JSON parsing fails, use status text
    return new ApiError(response.statusText || fallback, response.status);
  }
}
