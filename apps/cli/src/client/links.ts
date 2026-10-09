import type { Ctx } from "../registry/define"
import { resolver } from "./resolve"

// Web app links, as the web's own "Copy link" builds them, and API addresses of artifacts.
export const links = {
  workspace: (host: string, slug: string) => `${host}/w/${slug}/home`,
  project: (host: string, slug: string, projectId: string) =>
    `${host}/w/${slug}/projects/${projectId}`,
  task: (host: string, slug: string, task: { id: string; projectId: string }) =>
    `${host}/w/${slug}/projects/${task.projectId}?task=${task.id}`,
  settings: (host: string) => `${host}/settings`,
  // An artifact's own address (no id: the task's artifact list); a browser needs a web session.
  artifact: (host: string, taskId: string, id?: string) =>
    `${host}/api/tasks/${encodeURIComponent(taskId)}/artifacts${id ? `/${encodeURIComponent(id)}` : ""}`,
}

// Adds `url` to projects and tasks of one workspace: the one given by id (a task's own, which
// may not be the current one), else the current one.
export async function webLinks(ctx: Ctx, workspaceId?: string) {
  const [{ host }, { slug }] = await Promise.all([ctx.http(), resolver(ctx).workspace(workspaceId)])
  return {
    project: <P extends { id: string }>(project: P) => ({
      ...project,
      url: links.project(host, slug, project.id),
    }),
    task: <T extends { id: string; projectId: string }>(task: T) => ({
      ...task,
      url: links.task(host, slug, task),
    }),
  }
}
