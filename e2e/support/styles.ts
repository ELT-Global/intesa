import type { Locator, Page } from "@playwright/test"

/** Resolves a CSS variable to the browser's computed colour for the given property. */
export function tokenValue(
  page: Page,
  token: string,
  prop: "color" | "backgroundColor" = "color",
): Promise<string> {
  return page.evaluate(
    ([token, prop]) => {
      const el = document.createElement("span")
      el.style[prop] = `var(${token})`
      document.body.append(el)
      const value = getComputedStyle(el)[prop]
      el.remove()
      return value
    },
    [token, prop] as const,
  )
}

/** Computed value of a CSS property (kebab-case) on the element. */
export function style(locator: Locator, prop: string): Promise<string> {
  return locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), prop)
}
