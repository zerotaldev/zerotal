export { validate } from "./validate.ts";
export { FormRequest } from "./FormRequest.ts";
export { ValidatorFacade as Validator } from "./facades/Validator.ts";
export { RuleBuilder } from "./RuleBuilder.ts";
export {
  StringRule,
  NumberRule,
  BooleanRule,
  ArrayRule,
  ObjectRule,
  DateRule,
  FileRule,
  PasswordRule,
} from "./FieldRule.ts";
export type { FieldRule } from "./FieldRule.ts";
export { ValidationRedirectError, ValidationJsonError } from "./ValidationError.ts";
export { PrecognitionResponseError } from "./PrecognitionError.ts";
export { runValidation, runValidationAsync } from "./Validator.ts";
export { runStringRules, runStringRulesAsync } from "./stringRules.ts";
export type { StringRules } from "./stringRules.ts";
export { registerDbRuleRunner } from "./dbRules.ts";
export type { UniqueOptions } from "./dbRules.ts";
export type {
  Schema,
  FieldRuleDefinition,
  ValidationErrors,
  Infer,
  ValidationOutcome,
  InferFieldType,
} from "./types.ts";

// Config factory
export { ValidatorConfig } from "./config.ts";
export type { ValidatorConfigShape } from "./config.ts";
