import { Hono } from 'hono';
import { createGitProxyHandler, type GitProxyDependencies } from './proxy';

export function createGitRoutes(deps: GitProxyDependencies): Hono {
  const routes = new Hono();
  routes.all('*', createGitProxyHandler(deps));
  return routes;
}
