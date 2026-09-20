import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize API errors to a consistent format
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
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

/**
 * Parse API error response
 */
export async function parseErrorResponse(
  response: Response
): Promise<ApiError> {
  let message = `Request failed with status ${response.status}`;
  let code: string | undefined;
  let details: unknown;

  try {
    const data = await response.json();
    message = data.message || data.error || message;
    code = data.code;
    details = data.details || data;
  } catch {
    // If JSON parsing fails, use status text
    message = response.statusText || message;
  }

  return new ApiError(message, response.status, code, details);
}
