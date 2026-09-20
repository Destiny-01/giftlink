import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { ValidationError } from "../utils/errors";

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`
        );
        next(new ValidationError(messages.join(", ")));
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
        const messages = error.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`
        );
        next(new ValidationError(messages.join(", ")));
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
        const messages = error.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`
        );
        next(new ValidationError(messages.join(", ")));
      } else {
        next(new ValidationError("Parameter validation failed"));
      }
    }
  };
}
