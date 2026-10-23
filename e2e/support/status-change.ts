import { expect, type Page } from "@playwright/test"

export const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true })

/** The dialog for a move into Complete (it also asks for the sign-off). */
export const completeDialog = (page: Page) => page.getByRole("dialog", { name: "Complete task" })

/** The dialog for any other move that has a question (who did it). */
export const moveDialog = (page: Page) => page.getByRole("dialog", { name: "Move task" })

/** Answers "Reviewed by"/"Tested by" in the completion dialog with a member or "Nobody". */
export async function answer(page: Page, question: string, who: string | RegExp) {
  await completeDialog(page)
    .getByRole("button", { name: new RegExp(`^${question}:`) })
    .click()
  await page.getByRole("option", { name: who }).click()
  // The picker animates out; the next one must not find its options.
  await expect(page.getByRole("option")).toHaveCount(0)
}

export async function answerBoth(page: Page, reviewer: string | RegExp, tester: string | RegExp) {
  await answer(page, "Reviewed by", reviewer)
  await answer(page, "Tested by", tester)
}
