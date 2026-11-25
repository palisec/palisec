/**
 * Feature flags, fixed when the app is built (next.config.ts passes them to server and browser code alike,
 * so code behind a flag that is off is left out of the browser bundles entirely).
 *
 * UPOCH: the Upoch integration in the console, its API and its public mentions. Off unless FEATURE_UPOCH=true.
 * Off keeps the code, the data and the policy rule's enforcement; only what is shown and served changes.
 */
export const UPOCH = process.env.FEATURE_UPOCH === "true";
