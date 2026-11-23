import { requireMember } from "@/server/access";
import { setDelays } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

/** Loosening delay: loosening and emergency-stop lift delays (owner). Lowering one waits out the current delay. */
export const POST = handle(async (req) => ok(await setDelays(await requireMember(req, "own"), await readJson(req))));
