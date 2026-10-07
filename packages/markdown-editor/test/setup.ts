import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

// CodeMirror measures text through Range rects; happy-dom has none.
const emptyRects = () => ({ item: () => null, length: 0, [Symbol.iterator]: function* () {} })
Range.prototype.getClientRects ??= emptyRects as never
Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0)
