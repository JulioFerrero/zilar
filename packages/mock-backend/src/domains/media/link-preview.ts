// The link-preview route for mock mode (T-1241). The server mounts the route in
// the media API module (T-1234) and answers 204 when the page has nothing to
// show; mock mode has no network, so every URL answers 204 and the card stays
// hidden — but the call is served instead of 404ing, so mock mode logs nothing.
import { noContent, type MockHttpRequest } from '../../http/shared';

export function handleLinkPreview(request: MockHttpRequest): Response | undefined {
  if (request.segments.length !== 1 || request.segments[0] !== 'link-preview') {
    return undefined;
  }
  if (request.method !== 'GET') {
    return undefined;
  }
  return noContent();
}
