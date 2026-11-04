import { requireMember } from "@/server/access";
import { listApprovals } from "@/server/approvals";
import { handle, ok } from "@/server/http";

/** ?status=pending (default) or decided. Pending items include the EIP-712 data an approver signs. */
export const GET = handle(async (req) =>
  ok({ approvals: await listApprovals(await requireMember(req, "read"), new URL(req.url).searchParams) }),
);
