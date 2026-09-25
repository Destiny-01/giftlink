import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError, ZodIssue } from "zod";
import { ValidationError } from "../utils/errors";

/**
 * A validation summary that never repeats the value it rejected.
 *
 * The body being validated is caller-supplied, and several of Zod's messages interpolate
 * what they received - `invalid_enum_value` names the rejected value, `unrecognized_keys`
 * names the keys. Echoing those would put caller data, including anything a caller chose to
 * send in the wrong field, into both the response and the log record. Only schema-authored
 * text (paths, expected types, accepted options, custom messages) is included.
 */
function describeIssues(error: ZodError): string {
  return error.errors.map(describeIssue).join(", ");
}

function describeIssue(issue: ZodIssue): string {
  const path = issue.path.join(".") || "body";

  switch (issue.code) {
    case "invalid_enum_value":
      return `${path}: expected one of ${issue.options.join(" | ")}`;
    case "unrecognized_keys":
      return `${path}: contains fields this endpoint does not accept`;
    default:
      return `${path}: ${issue.message}`;
  }
}

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError(describeIssues(error)));
      } else {
        next(new ValidationError("Validation failed"));
      }
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError(describeIssues(error)));
      } else {
        next(new ValidationError("Query validation failed"));
      }
    }
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError(describeIssues(error)));
      } else {
        next(new ValidationError("Parameter validation failed"));
      }
    }
  };
}
