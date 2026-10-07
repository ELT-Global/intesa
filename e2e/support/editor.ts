import type { Locator, Page } from "@playwright/test"

/** The description field inside a dialog or sheet, whichever implementation is mounted. */
export const description = (scope: Page | Locator) =>
  scope.getByRole("textbox", { name: "Description" })

/** The editor wrapper; `data-editor` flips to "ready" once CodeMirror has replaced the textarea. */
export const editorHost = (scope: Page | Locator) => scope.locator("[data-editor]")
