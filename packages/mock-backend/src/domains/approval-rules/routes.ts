// `GET /ais/:id/approval-rules`, `GET /groups/:id/approval-rules` and
// `DELETE /approval-rules/:id` (T-0941), mirroring web's mock. The mock user
// owns every group, so the group list needs no membership check; removing a
// missing rule is silent (204), like the server.

import type { MockData } from '../../state';
import { jsonResponse, noContent, type MockHttpRequest } from '../../http/shared';

export function handleApprovalRules(
  data: MockData,
  request: MockHttpRequest,
): Response | undefined {
  const [head, first, second] = request.segments;
  if (
    head === 'ais' &&
    second === 'approval-rules' &&
    first !== undefined &&
    request.method === 'GET'
  ) {
    return jsonResponse(data.approvalRules.filter((rule) => rule.aiId === first));
  }
  if (
    head === 'groups' &&
    second === 'approval-rules' &&
    first !== undefined &&
    request.method === 'GET'
  ) {
    return jsonResponse(data.approvalRules.filter((rule) => rule.groupId === first));
  }
  if (
    head === 'approval-rules' &&
    request.segments.length === 2 &&
    first !== undefined &&
    request.method === 'DELETE'
  ) {
    const ruleId = decodeURIComponent(first);
    const at = data.approvalRules.findIndex((rule) => rule.id === ruleId);
    if (at !== -1) {
      data.approvalRules.splice(at, 1);
    }
    return noContent();
  }
  return undefined;
}
