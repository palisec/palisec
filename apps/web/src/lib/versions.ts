import { SCHEMA_VERSIONS } from "@palisec/policy-schema";
import sdk from "../../../../packages/sdk/package.json";
import peaa from "../../../../packages/policy-enforced-accounts/package.json";

/**
 * Package and schema versions shown on the site, from one place. The TypeScript SDK and the library are read
 * from their package.json; the Python SDK's version lives in packages/sdk-python/src/palisec/__init__.py and is
 * mirrored here (the Python build checks the wheel in apps/web/public/sdk against it).
 */
export const VERSIONS = {
  sdkTs: sdk.version,
  sdkPy: "0.4.10",
  peaa: peaa.version,
  schema: SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1],
} as const;

export const SCHEMA_LABEL = `Schema ${VERSIONS.schema}`;
export const PY_WHEEL = `https://palisec.tech/sdk/palisec-${VERSIONS.sdkPy}-py3-none-any.whl`;
export const TS_TGZ = `https://palisec.tech/sdk/palisec-sdk-${VERSIONS.sdkTs}.tgz`;
